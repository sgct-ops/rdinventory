import type { Metadata, Viewport } from "next";
// fonts are served by the app itself: no wait on Google, and they work offline on the floor
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./globals.css";

export const metadata: Metadata = { title: "Rajdanga Fabric", description: "Fabric inventory and warehouse — source of truth" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f6f5f2" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
