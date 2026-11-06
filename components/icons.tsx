import type { ReactNode } from "react";

export function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconMaximize = () => (
  <Icon>
    <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
  </Icon>
);

export const IconOnline = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12.5 2.7 2.7L16 9.8" />
  </Icon>
);

export const IconOffline = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="m15 9-6 6M9 9l6 6" />
  </Icon>
);

export const IconWarning = () => (
  <Icon>
    <path d="M12 4 2.8 20h18.4L12 4Z" />
    <path d="M12 10v4.5M12 17.5v.01" />
  </Icon>
);

export const IconUnknown = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12h8" />
  </Icon>
);

export const IconPause = () => (
  <Icon>
    <path d="M9 6v12M15 6v12" />
  </Icon>
);

export const IconPlay = () => (
  <Icon>
    <path d="m8 5 11 7-11 7V5Z" />
  </Icon>
);

export const IconClose = () => (
  <Icon>
    <path d="m6 6 12 12M18 6 6 18" />
  </Icon>
);

export const IconPlus = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const IconGrid = () => (
  <Icon>
    <rect x="4" y="4" width="7" height="7" rx="1.5" />
    <rect x="13" y="4" width="7" height="7" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" />
    <rect x="13" y="13" width="7" height="7" rx="1.5" />
  </Icon>
);

export const IconLayers = () => (
  <Icon>
    <path d="m12 3 9 5-9 5-9-5 9-5Z" />
    <path d="m3 13 9 5 9-5" />
  </Icon>
);

export const IconDevices = () => (
  <Icon>
    <rect x="3" y="5" width="13" height="10" rx="2" />
    <path d="M7 19h5M9.5 15v4" />
    <rect x="18" y="9" width="3" height="10" rx="1" />
  </Icon>
);

export const IconBookmark = () => (
  <Icon>
    <path d="M6 4h12v17l-6-4-6 4V4Z" />
  </Icon>
);

export const IconSliders = () => (
  <Icon>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="8" cy="17" r="2" />
  </Icon>
);

export const IconEvents = () => (
  <Icon>
    <path d="M3 12h4l3-8 4 16 3-8h4" />
  </Icon>
);

export const IconServer = () => (
  <Icon>
    <rect x="4" y="4" width="16" height="7" rx="2" />
    <rect x="4" y="13" width="16" height="7" rx="2" />
    <path d="M8 7.5v.01M8 16.5v.01" />
  </Icon>
);

export const IconUsers = () => (
  <Icon>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M3 20c.6-3.6 3-5.5 6-5.5s5.4 1.9 6 5.5M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c1.6.8 2.7 2.5 3 5.2" />
  </Icon>
);

export const IconGauge = () => (
  <Icon>
    <path d="M4 18a9 9 0 1 1 16 0" />
    <path d="m12 14 4-5" />
  </Icon>
);

export const IconAccount = () => (
  <Icon>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c.8-4.4 4-6.5 8-6.5s7.2 2.1 8 6.5" />
  </Icon>
);

export const IconPlug = () => (
  <Icon>
    <path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4" />
  </Icon>
);

export const IconChip = () => (
  <Icon>
    <rect x="6" y="6" width="12" height="12" rx="2" />
    <path d="M10 10h4v4h-4zM9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
  </Icon>
);

export const IconLogout = () => (
  <Icon>
    <path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9" />
  </Icon>
);

export const IconMap = () => (
  <Icon>
    <path d="M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4z" />
    <path d="M9 4v13.5M15 6.5V20" />
  </Icon>
);

export const IconRadar = () => (
  <Icon>
    <circle cx="12" cy="12" r="2" />
    <path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4" />
    <path d="M19.1 4.9a10 10 0 0 1 0 14.2M4.9 19.1a10 10 0 0 1 0-14.2" />
  </Icon>
);

export const IconWrench = () => (
  <Icon>
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z" />
  </Icon>
);

export const IconUnreachable = () => (
  <Icon>
    <path d="M9 17H7A5 5 0 0 1 5.5 7.2M15 7h2a5 5 0 0 1 3.5 8.5M8 12h3M3 3l18 18" />
  </Icon>
);

export const IconClock = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
);
