import { invoke } from "@tauri-apps/api/core";

export interface SftpEntry {
  name: string;
  path: string;
  is_dir: boolean;
  is_symlink: boolean;
  size: number;
  modified: number | null;
}

export function sftpConnect(hostId: string): Promise<string> {
  return invoke("sftp_connect", { hostId });
}

export function sftpCanonicalize(sftpId: string, path: string): Promise<string> {
  return invoke("sftp_canonicalize", { sftpId, path });
}

export function sftpList(sftpId: string, path: string): Promise<SftpEntry[]> {
  return invoke("sftp_list", { sftpId, path });
}

export function sftpMkdir(sftpId: string, path: string): Promise<void> {
  return invoke("sftp_mkdir", { sftpId, path });
}

export function sftpRename(sftpId: string, from: string, to: string): Promise<void> {
  return invoke("sftp_rename", { sftpId, from, to });
}

export function sftpRemoveFile(sftpId: string, path: string): Promise<void> {
  return invoke("sftp_remove_file", { sftpId, path });
}

export function sftpRemoveDir(sftpId: string, path: string): Promise<void> {
  return invoke("sftp_remove_dir", { sftpId, path });
}

export function sftpDownload(
  sftpId: string,
  remotePath: string,
  localPath: string,
): Promise<void> {
  return invoke("sftp_download", { sftpId, remotePath, localPath });
}

export function sftpUpload(sftpId: string, localPath: string, remotePath: string): Promise<void> {
  return invoke("sftp_upload", { sftpId, localPath, remotePath });
}

export function sftpDisconnect(sftpId: string): Promise<void> {
  return invoke("sftp_disconnect", { sftpId });
}
