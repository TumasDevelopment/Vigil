import type { ReactNode } from "react";
import { deviceLabel, type DeviceType } from "@/lib/scope";
import { Icon } from "./icons";

const SHAPES: Record<DeviceType, ReactNode> = {
  server: (
    <>
      <rect x="4" y="4" width="16" height="7" rx="2" />
      <rect x="4" y="13" width="16" height="7" rx="2" />
      <path d="M8 7.5v.01M8 16.5v.01" />
    </>
  ),
  storage: (
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </>
  ),
  switch: (
    <>
      <rect x="3" y="8" width="18" height="8" rx="2" />
      <path d="M7 12v.01M11 12v.01M15 12v.01M19 12v.01" />
    </>
  ),
  router: <path d="M12 3 4 6v6c0 4.5 3.2 7.6 8 9 4.8-1.4 8-4.5 8-9V6l-8-3Z" />,
  wifi: <path d="M3 9.5c5.2-4.7 12.8-4.7 18 0M6.5 13.2c3.2-2.9 7.8-2.9 11 0M10 16.8c1.2-1 2.8-1 4 0M12 20v.01" />,
  pc: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M9 20h6M12 16v4" />
    </>
  ),
  stampante: (
    <>
      <path d="M7 9V3h10v6M7 17H4v-8h16v8h-3" />
      <path d="M7 14h10v7H7z" />
    </>
  ),
  telecamera: (
    <>
      <rect x="3" y="7" width="12" height="10" rx="2" />
      <path d="m15 11 6-3v8l-6-3" />
    </>
  ),
  macchina: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
    </>
  ),
  altro: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12v.01M12 12v.01M16 12v.01" />
    </>
  ),
};

export function DeviceIcon({ type }: { type: DeviceType }) {
  return (
    <span className="device-icon" title={deviceLabel(type)}>
      <Icon>{SHAPES[type]}</Icon>
    </span>
  );
}
