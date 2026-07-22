import GoogleBackupSection from "./GoogleBackupSection";

// Its own Activity Bar destination (the "Google sign-in" icon) rather than a
// section buried inside Settings, mirroring VSCode's dedicated Accounts icon.
export default function BackupPanel() {
  return (
    <div className="max-w-xl">
      <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-50">
        Google Backup
      </h2>
      <GoogleBackupSection />
    </div>
  );
}
