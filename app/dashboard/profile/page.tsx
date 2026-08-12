"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/auth-context";
import { Loader2 } from "lucide-react";

export default function ProfilePage() {
  const { profile, loading, logout } = useAuth();
  const router = useRouter();

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  if (loading || !profile) {
    return (
      <div className="flex items-center gap-2 p-6 text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-lg">
      <h1 className="text-2xl font-bold text-gray-900">Profile</h1>

      <div className="rounded-lg bg-white border border-gray-200 shadow-sm p-4 space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Name</span>
          <span className="text-gray-900">{profile.displayName}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Email</span>
          <span className="text-gray-900">{profile.email}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Role</span>
          <span
            className={`font-mono px-2 py-0.5 rounded-full text-xs font-medium ${
              profile.role === "admin"
                ? "bg-purple-50 text-purple-700"
                : "bg-blue-50 text-blue-700"
            }`}
          >
            {profile.role}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Status</span>
          <span
            className={`font-mono px-2 py-0.5 rounded-full text-xs font-medium ${
              profile.active !== false
                ? "bg-green-50 text-green-700"
                : "bg-red-50 text-red-700"
            }`}
          >
            {profile.active !== false ? "Active" : "Inactive"}
          </span>
        </div>
      </div>

      <button
        onClick={handleLogout}
        className="w-full rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500"
      >
        Logout
      </button>
    </div>
  );
}
