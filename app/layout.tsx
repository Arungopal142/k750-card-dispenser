import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "../lib/auth-context";
import { ToastProvider } from "../lib/toast-context";
import { K750Provider } from "../lib/k750-context";
import Providers from "../components/Providers";

const jakartaSans = Plus_Jakarta_Sans({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "K750 Card Dispenser",
  description: "K750 Card Dispenser Management System",
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
        <Providers>
          <AuthProvider>
            <K750Provider>
              <ToastProvider>{children}</ToastProvider>
            </K750Provider>
          </AuthProvider>
        </Providers>
      </body>
    </html>
  );
}
