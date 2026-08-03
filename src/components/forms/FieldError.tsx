interface FieldErrorProps {
  message?: string;
}

// Renders directly under the input it applies to - see lib/formValidation.ts
// for why this exists alongside the older bottom-of-form errorClass banner.
export default function FieldError({ message }: FieldErrorProps) {
  if (!message) return null;
  return <p className="-mt-3 mb-3 text-xs text-red-600 dark:text-red-400">{message}</p>;
}
