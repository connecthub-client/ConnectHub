import GoogleBackupSection from "./GoogleBackupSection";
import { PanelScaffold } from "../common/PanelScaffold";

// Its own Activity Bar destination (the "Google sign-in" icon) rather than a
// section buried inside Settings, mirroring VSCode's dedicated Accounts icon.
export default function BackupPanel() {
  return (
    <PanelScaffold title="Google Backup" description="Keep an encrypted copy of your ConnectHub configuration available across your devices.">
      <div className="max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"><GoogleBackupSection /></div>
    </PanelScaffold>
  );
}
