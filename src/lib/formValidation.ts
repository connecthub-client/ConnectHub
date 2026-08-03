// Field-keyed validation errors, e.g. { label: "Enter a label." } - shown
// next to the specific input via components/forms/FieldError.tsx, instead
// of every form's previous single bottom-of-form error string for this
// class of error. The bottom banner (formStyles.ts's errorClass) is kept
// separately for genuinely cross-field/server-side failures (a failed
// backend call) that don't belong to one input.
export type FieldErrors = Record<string, string>;
