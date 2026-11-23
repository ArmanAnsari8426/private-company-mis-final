import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Company MIS | Private Dashboard", description: "Private multi-company MIS dashboard" };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }