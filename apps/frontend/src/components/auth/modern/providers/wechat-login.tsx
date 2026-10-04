import { ProviderButton, ProviderButtonProps } from './provider-button';
export function WechatLogin(props: ProviderButtonProps) {
  return (
    <ProviderButton
      {...props}
      id="wechat"
      name="微信"
      icon={
        <svg viewBox="0 0 32 28" width="28" height="26" aria-hidden="true">
          <path
            fill="#26C45B"
            d="M13 1C6.4 1 1 5.2 1 10.5c0 3 1.8 5.7 4.6 7.4l-1 3.2 4-1.9c1.4.5 2.9.8 4.4.8 6.6 0 12-4.3 12-9.5S19.6 1 13 1Z"
          />
          <circle cx="9" cy="8" r="1.4" fill="white" />
          <circle cx="17" cy="8" r="1.4" fill="white" />
          <path
            fill="#26C45B"
            stroke="white"
            strokeWidth="1.4"
            d="M21 10c-5.5 0-10 3.6-10 8s4.5 8 10 8c1.3 0 2.5-.2 3.7-.6l3.6 1.4-.9-2.8C29.7 22.5 31 20.4 31 18c0-4.4-4.5-8-10-8Z"
          />
          <circle cx="17.5" cy="16" r="1.1" fill="white" />
          <circle cx="24.5" cy="16" r="1.1" fill="white" />
        </svg>
      }
    />
  );
}
