import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { AuthProvider } from "../lib/auth-context";
import { ToastProvider } from "../lib/toast-context";
import { K750Provider } from "../lib/k750-context";
import FontSizeLoader from "./font-size-loader";

const jakartaSans = localFont({
  src: "./fonts/PlusJakartaSansVariable.woff2",
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVariable.woff2",
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "VMS Card Dispenser",
  description: "VMS Card Dispenser Management System",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${jakartaSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body
        className="min-h-full flex flex-col"
        style={{ background: "#f8fafc", color: "#0f172a" }}
      >
        <AuthProvider>
          <K750Provider>
            <ToastProvider>
              <FontSizeLoader />
              {children}
            </ToastProvider>
          </K750Provider>
        </AuthProvider>
      </body>
    </html>
  );
}
