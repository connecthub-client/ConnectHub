export const RELEASES_URL = "https://github.com/connecthub-client/ConnectHub/releases/latest";

export function friendlyUpdaterError(error: unknown): string {
  const message = String(error);

  if (message.includes("valid release JSON") || message.includes("release JSON")) {
    return "The update service returned an invalid response. Please try again shortly.";
  }
  if (message.includes("invalid updater binary format")) {
    return "Automatic install isn't supported for this installation. Download the new version from the releases page instead.";
  }
  if (/network|fetch|request|connection|timed? out/i.test(message)) {
    return "ConnectHub couldn't reach the update service. Check your connection and try again.";
  }

  return message;
}
