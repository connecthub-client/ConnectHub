// Visual required-field indicator - every form's controls are already
// custom-themed (themed-select, custom focus rings), so relying only on
// the native `required` attribute's unstyled browser validation bubble to
// communicate this was inconsistent with everything else about them.
export default function RequiredMark() {
  return <span className="text-red-500"> *</span>;
}
