import { ProviderButton, ProviderButtonProps } from './provider-button';
export function GoogleLogin(props: ProviderButtonProps) {
  return (
    <ProviderButton
      {...props}
      id="google"
      name="Google"
      icon={
        <svg viewBox="0 0 48 48" width="26" height="26" aria-hidden="true">
          <path
            fill="#FFC107"
            d="M43.6 20H24v8h11.3A12 12 0 1 1 32 15l5.7-5.7A20 20 0 1 0 44 24c0-1.4-.1-2.7-.4-4Z"
          />
          <path
            fill="#EA4335"
            d="m6.3 14.7 6.6 4.8A12 12 0 0 1 32 15l5.7-5.7A20 20 0 0 0 6.3 14.7Z"
          />
          <path
            fill="#34A853"
            d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2a12 12 0 0 1-18.5-5.5l-6.5 5A20 20 0 0 0 24 44Z"
          />
          <path
            fill="#4285F4"
            d="M43.6 20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2A20 20 0 0 0 44 24c0-1.4-.1-2.7-.4-4Z"
          />
        </svg>
      }
    />
  );
}
