// In-process SSH server for hermetic tests of this crate's client-side
// ssh/*.rs code. The `*::live_sshd_tests` modules alongside these tests
// exercise the real thing against a real local sshd, but are `#[ignore]`d
// and need manual one-time setup (a throwaway keypair added to
// ~/.ssh/authorized_keys) - they never run in a normal `cargo test` or CI.
// This gives session.rs/sftp.rs/tunnel.rs/exec.rs's core logic *some*
// coverage that runs by default, at the cost of only approximating a real
// server: auth accepts exactly one generated-per-test keypair, "exec" and
// "shell" are a canned fake rather than a real shell, and SFTP is backed
// by a real temp directory rather than an in-memory filesystem.
#![cfg(test)]

use std::collections::{HashMap, VecDeque};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use rand_core::OsRng;
use russh::keys::key::{KeyPair, PublicKey};
use russh::server::{Auth, Handler as ServerHandler, Msg, Server as ServerTrait, Session};
use russh::{Channel, ChannelId, Pty};
use russh_sftp::protocol::{Attrs, Data, File, FileAttributes, Handle, Name, OpenFlags, Status, StatusCode, Version};
use ssh_key::{Algorithm, LineEnding};
use tokio::fs::OpenOptions;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use uuid::Uuid;

// Generates a fresh Ed25519 keypair the same way data::ssh_keys::generate()
// does (ssh_key::PrivateKey, not russh's own KeyPair type, which this
// version of russh-keys can only decode from a PEM string, not construct
// or export to one directly) and immediately decodes it back through
// russh::keys::decode_secret_key - the same function the production
// connect_and_authenticate() call site uses - so both the PEM string
// (handed to the client under test) and the russh-side KeyPair/PublicKey
// (used by the test server) are guaranteed to describe the same key.
fn generate_test_keypair() -> (String, KeyPair) {
    let private_key =
        ssh_key::PrivateKey::random(&mut OsRng, Algorithm::Ed25519).expect("failed to generate test key");
    let pem = private_key
        .to_openssh(LineEnding::LF)
        .expect("failed to encode test key as OpenSSH PEM")
        .to_string();
    let key_pair = russh::keys::decode_secret_key(&pem, None).expect("failed to decode freshly generated test key");
    (pem, key_pair)
}

pub struct TestServer {
    pub port: u16,
    pub client_key_pem: String,
    pub sftp_root: PathBuf,
    _handle: tokio::task::JoinHandle<()>,
}

impl TestServer {
    /// Starts the server on an OS-assigned local port and returns once
    /// it's ready to accept connections. `client_key_pem` is a freshly
    /// generated Ed25519 private key (OpenSSH format) that is the *only*
    /// identity the server will authenticate - matches the pattern the
    /// production connect_and_authenticate() call site uses
    /// (russh::keys::decode_secret_key(&pem, ...)).
    pub async fn start() -> Self {
        let (_host_pem, host_key) = generate_test_keypair();
        let (client_key_pem, client_key) = generate_test_keypair();
        let client_public_key = client_key.clone_public_key().expect("failed to derive public key");

        let sftp_root = std::env::temp_dir().join(format!("connecthub-test-sftp-root-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&sftp_root).expect("failed to create sftp test root");

        let config = Arc::new(russh::server::Config {
            auth_rejection_time: Duration::from_millis(50),
            auth_rejection_time_initial: Some(Duration::from_millis(0)),
            keys: vec![host_key],
            ..Default::default()
        });

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("failed to bind test server listener");
        let port = listener.local_addr().unwrap().port();

        let mut server = TestSshServer {
            client_public_key,
            sftp_root: sftp_root.clone(),
        };

        let handle = tokio::spawn(async move {
            let _ = server.run_on_socket(config, &listener).await;
        });

        // The listener above is already bound (the port is real
        // immediately), but give the spawned accept loop a moment to
        // actually schedule before the caller starts connecting.
        tokio::time::sleep(Duration::from_millis(20)).await;

        Self {
            port,
            client_key_pem,
            sftp_root,
            _handle: handle,
        }
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self._handle.abort();
        let _ = std::fs::remove_dir_all(&self.sftp_root);
    }
}

#[derive(Clone)]
struct TestSshServer {
    client_public_key: PublicKey,
    sftp_root: PathBuf,
}

impl ServerTrait for TestSshServer {
    type Handler = TestSession;

    fn new_client(&mut self, _addr: Option<SocketAddr>) -> Self::Handler {
        TestSession {
            client_public_key: self.client_public_key.clone(),
            sftp_root: self.sftp_root.clone(),
            channels: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

struct TestSession {
    client_public_key: PublicKey,
    sftp_root: PathBuf,
    channels: Arc<Mutex<HashMap<ChannelId, Channel<Msg>>>>,
}

impl TestSession {
    async fn take_channel(&self, id: ChannelId) -> Option<Channel<Msg>> {
        self.channels.lock().await.remove(&id)
    }
}

#[async_trait]
impl ServerHandler for TestSession {
    type Error = russh::Error;

    async fn auth_publickey(&mut self, _user: &str, public_key: &PublicKey) -> Result<Auth, Self::Error> {
        if *public_key == self.client_public_key {
            Ok(Auth::Accept)
        } else {
            Ok(Auth::Reject { proceed_with_methods: None })
        }
    }

    async fn channel_open_session(
        &mut self,
        channel: Channel<Msg>,
        _session: &mut Session,
    ) -> Result<bool, Self::Error> {
        self.channels.lock().await.insert(channel.id(), channel);
        Ok(true)
    }

    async fn pty_request(
        &mut self,
        channel: ChannelId,
        _term: &str,
        _col_width: u32,
        _row_height: u32,
        _pix_width: u32,
        _pix_height: u32,
        _modes: &[(Pty, u32)],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.channel_success(channel);
        Ok(())
    }

    async fn shell_request(&mut self, channel: ChannelId, session: &mut Session) -> Result<(), Self::Error> {
        session.channel_success(channel);
        Ok(())
    }

    // Fake shell: whatever the client sends over an interactive session is
    // echoed straight back, which is enough to exercise the PTY/data-relay
    // path in session.rs without a real shell.
    async fn data(&mut self, channel: ChannelId, data: &[u8], session: &mut Session) -> Result<(), Self::Error> {
        session.data(channel, data.to_vec().into());
        Ok(())
    }

    // Fake `exec`: recognizes forms used by this crate's tests rather than
    // actually running a shell - `exit <n>` writes a fixed message to
    // stderr and exits with code n; anything else is echoed back to stdout
    // verbatim (trailing newline added) and exits 0.
    async fn exec_request(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        let command = String::from_utf8_lossy(data).to_string();

        if let Some(rest) = command.strip_prefix("exit ") {
            let code: u32 = rest.trim().parse().unwrap_or(1);
            session.extended_data(channel, 1, b"simulated failure on stderr\n".to_vec().into());
            session.exit_status_request(channel, code);
            session.close(channel);
            return Ok(());
        }

        session.data(channel, format!("{command}\n").into_bytes().into());
        session.exit_status_request(channel, 0);
        session.close(channel);
        Ok(())
    }

    async fn subsystem_request(
        &mut self,
        channel_id: ChannelId,
        name: &str,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        if name != "sftp" {
            session.channel_failure(channel_id);
            return Ok(());
        }
        let Some(channel) = self.take_channel(channel_id).await else {
            session.channel_failure(channel_id);
            return Ok(());
        };
        session.channel_success(channel_id);
        let handler = TestSftpHandler::new(self.sftp_root.clone());
        tokio::spawn(async move {
            russh_sftp::server::run(channel.into_stream(), handler).await;
        });
        Ok(())
    }

    // Local port forwarding (direct-tcpip): connects to the requested
    // target and pumps bytes between it and the channel - tunnel.rs's
    // local-forward tests point the target host/port at a plain test TCP
    // listener, so this doesn't need to understand SSH at all beyond
    // relaying raw bytes both ways.
    async fn channel_open_direct_tcpip(
        &mut self,
        channel: Channel<Msg>,
        host_to_connect: &str,
        port_to_connect: u32,
        _originator_address: &str,
        _originator_port: u32,
        _session: &mut Session,
    ) -> Result<bool, Self::Error> {
        let target = format!("{host_to_connect}:{port_to_connect}");
        match TcpStream::connect(&target).await {
            Ok(stream) => {
                tokio::spawn(pump_channel_to_tcp(channel, stream));
                Ok(true)
            }
            Err(_) => Ok(false),
        }
    }
}

// Relays bytes between an accepted direct-tcpip SSH channel and the plain
// TCP connection it was opened for - mirrors what a real sshd's local port
// forwarding does, minimally.
async fn pump_channel_to_tcp(mut channel: Channel<Msg>, mut stream: TcpStream) {
    let mut buf = [0u8; 8192];
    loop {
        tokio::select! {
            n = stream.read(&mut buf) => {
                match n {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if channel.data(&buf[..n]).await.is_err() {
                            break;
                        }
                    }
                }
            }
            msg = channel.wait() => {
                match msg {
                    Some(russh::ChannelMsg::Data { data }) => {
                        if stream.write_all(&data).await.is_err() {
                            break;
                        }
                    }
                    Some(russh::ChannelMsg::Eof) | Some(russh::ChannelMsg::Close) | None => break,
                    _ => {}
                }
            }
        }
    }
}

// Backs the sftp subsystem with a real temp directory rather than an
// in-memory model, so open/read/write/stat/mkdir/remove/rename exercise
// real filesystem semantics - only the operations ssh/sftp.rs's client
// code actually calls are implemented; everything else falls back to the
// trait's default `unimplemented()`.
struct TestSftpHandler {
    root: PathBuf,
    open_files: HashMap<String, tokio::fs::File>,
    open_dirs: HashMap<String, VecDeque<std::fs::DirEntry>>,
    next_handle: u64,
}

impl TestSftpHandler {
    fn new(root: PathBuf) -> Self {
        Self {
            root,
            open_files: HashMap::new(),
            open_dirs: HashMap::new(),
            next_handle: 0,
        }
    }

    fn resolve(&self, path: &str) -> PathBuf {
        let trimmed = path.trim_start_matches('/');
        if trimmed.is_empty() {
            self.root.clone()
        } else {
            self.root.join(trimmed)
        }
    }

    fn new_handle(&mut self) -> String {
        self.next_handle += 1;
        self.next_handle.to_string()
    }
}

impl russh_sftp::server::Handler for TestSftpHandler {
    type Error = StatusCode;

    fn unimplemented(&self) -> Self::Error {
        StatusCode::OpUnsupported
    }

    async fn init(&mut self, _version: u32, _extensions: HashMap<String, String>) -> Result<Version, Self::Error> {
        Ok(Version::new())
    }

    async fn open(
        &mut self,
        id: u32,
        filename: String,
        pflags: OpenFlags,
        _attrs: FileAttributes,
    ) -> Result<Handle, Self::Error> {
        let path = self.resolve(&filename);
        let options: std::fs::OpenOptions = pflags.into();
        let file = OpenOptions::from(options)
            .open(&path)
            .await
            .map_err(|_| StatusCode::NoSuchFile)?;
        let handle = self.new_handle();
        self.open_files.insert(handle.clone(), file);
        Ok(Handle { id, handle })
    }

    async fn close(&mut self, id: u32, handle: String) -> Result<Status, Self::Error> {
        self.open_files.remove(&handle);
        self.open_dirs.remove(&handle);
        Ok(ok_status(id))
    }

    async fn read(&mut self, id: u32, handle: String, offset: u64, len: u32) -> Result<Data, Self::Error> {
        let file = self.open_files.get_mut(&handle).ok_or(StatusCode::Failure)?;
        file.seek(std::io::SeekFrom::Start(offset)).await.map_err(|_| StatusCode::Failure)?;
        let mut buf = vec![0u8; len as usize];
        let n = file.read(&mut buf).await.map_err(|_| StatusCode::Failure)?;
        if n == 0 {
            return Err(StatusCode::Eof);
        }
        buf.truncate(n);
        Ok(Data { id, data: buf })
    }

    async fn write(&mut self, id: u32, handle: String, offset: u64, data: Vec<u8>) -> Result<Status, Self::Error> {
        let file = self.open_files.get_mut(&handle).ok_or(StatusCode::Failure)?;
        file.seek(std::io::SeekFrom::Start(offset)).await.map_err(|_| StatusCode::Failure)?;
        file.write_all(&data).await.map_err(|_| StatusCode::Failure)?;
        Ok(ok_status(id))
    }

    async fn opendir(&mut self, id: u32, path: String) -> Result<Handle, Self::Error> {
        let resolved = self.resolve(&path);
        let entries: VecDeque<std::fs::DirEntry> = std::fs::read_dir(&resolved)
            .map_err(|_| StatusCode::NoSuchFile)?
            .filter_map(|e| e.ok())
            .collect();
        let handle = self.new_handle();
        self.open_dirs.insert(handle.clone(), entries);
        Ok(Handle { id, handle })
    }

    async fn readdir(&mut self, id: u32, handle: String) -> Result<Name, Self::Error> {
        let entries = self.open_dirs.get_mut(&handle).ok_or(StatusCode::Failure)?;
        if entries.is_empty() {
            return Err(StatusCode::Eof);
        }
        let files = entries
            .drain(..)
            .filter_map(|entry| {
                let metadata = entry.metadata().ok()?;
                let name = entry.file_name().to_string_lossy().to_string();
                Some(File::new(name, FileAttributes::from(&metadata)))
            })
            .collect();
        Ok(Name { id, files })
    }

    async fn remove(&mut self, id: u32, filename: String) -> Result<Status, Self::Error> {
        std::fs::remove_file(self.resolve(&filename)).map_err(|_| StatusCode::Failure)?;
        Ok(ok_status(id))
    }

    async fn mkdir(&mut self, id: u32, path: String, _attrs: FileAttributes) -> Result<Status, Self::Error> {
        std::fs::create_dir(self.resolve(&path)).map_err(|_| StatusCode::Failure)?;
        Ok(ok_status(id))
    }

    async fn rmdir(&mut self, id: u32, path: String) -> Result<Status, Self::Error> {
        std::fs::remove_dir(self.resolve(&path)).map_err(|_| StatusCode::Failure)?;
        Ok(ok_status(id))
    }

    async fn rename(&mut self, id: u32, oldpath: String, newpath: String) -> Result<Status, Self::Error> {
        std::fs::rename(self.resolve(&oldpath), self.resolve(&newpath)).map_err(|_| StatusCode::Failure)?;
        Ok(ok_status(id))
    }

    async fn realpath(&mut self, id: u32, path: String) -> Result<Name, Self::Error> {
        Ok(Name { id, files: vec![File::dummy(path)] })
    }

    async fn stat(&mut self, id: u32, path: String) -> Result<Attrs, Self::Error> {
        let metadata = std::fs::metadata(self.resolve(&path)).map_err(|_| StatusCode::NoSuchFile)?;
        Ok(Attrs { id, attrs: FileAttributes::from(&metadata) })
    }

    async fn lstat(&mut self, id: u32, path: String) -> Result<Attrs, Self::Error> {
        self.stat(id, path).await
    }
}

fn ok_status(id: u32) -> Status {
    Status {
        id,
        status_code: StatusCode::Ok,
        error_message: "Ok".to_string(),
        language_tag: "en-US".to_string(),
    }
}
