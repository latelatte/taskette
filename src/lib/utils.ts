import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// navigator.platform is deprecated; prefer userAgentData (Chromium) and fall
// back to userAgent string. Used for ⌘ vs Ctrl modifier display in tooltips.
export const isMac: boolean = (() => {
  if (typeof navigator === 'undefined') return false;
  const uaData = (navigator as Navigator & {
    userAgentData?: { platform?: string };
  }).userAgentData;
  if (typeof uaData?.platform === 'string') return /mac/i.test(uaData.platform);
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
})();

