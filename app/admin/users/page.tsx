"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/auth-context";
import { getAllUsers, updateUser, deleteUser, type UserProfile, formatDateTime } from "../../../lib/firestore-service";
import { Loader2, UserCog, Shield, AlertCircle } from "lucide-react";

export default function UsersPage() {
  const { profile, loading } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<"admin" | "user">("user");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && (!profile || profile.role !== "admin")) router.replace("/login");
  }, [profile, loading, router]);

  const loadUsers = async () => {
    try {
      const data = await getAllUsers();
      setUsers(data);
      setError(null);
    } catch {
      setError("Failed to load users.");
    }
  };

  useEffect(() => {
    if (profile?.role !== "admin") return;
    // Load inside the effect (and ignore a late response after unmount) rather
    // than calling the shared loader synchronously from the effect body.
    let cancelled = false;
    const load = async () => {
      try {
        const data = await getAllUsers();
        if (!cancelled) { setUsers(data); setError(null); }
      } catch {
        if (!cancelled) setError("Failed to load users.");
      }
    };
    load();
    const interval = setInterval(load, 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [profile]);

  const handleToggleRole = async (u: UserProfile) => {
    if (u.uid === profile?.uid) { setError("Cannot change your own role."); return; }
    await updateUser(u.uid, { role: u.role === "admin" ? "user" : "admin" });
    await loadUsers();
  };

  const handleToggleActive = async (u: UserProfile) => {
    if (u.uid === profile?.uid) { setError("Cannot deactivate your own account."); return; }
    await updateUser(u.uid, { active: u.active === false ? true : false });
    await loadUsers();
  };

  const handleSave = async (uid: string) => {
    await updateUser(uid, { displayName: editName, role: editRole });
    setEditing(null);
    await loadUsers();
  };

  const handleDelete = async (uid: string) => {
    if (uid === profile?.uid) { setError("Cannot delete your own account."); return; }
    if (!confirm("Are you sure you want to delete this user? This action cannot be undone.")) return;
    setDeleting(uid);
    try {
      await deleteUser(uid);
      await loadUsers();
    } catch {
      setError("Failed to delete user.");
    }
    setDeleting(null);
  };

  const startEdit = (u: UserProfile) => {
    setEditing(u.uid);
    setEditName(u.displayName ?? "");
    setEditRole((u.role as "admin" | "user") ?? "user");
  };

  if (loading || !profile)
    return (
      <div style={{ padding: 24, color: "#64748b" }} className="flex items-center gap-2">
        <Loader2 className="animate-spin" style={{ width: 20, height: 20 }} />
        Loading...
      </div>
    );

  return (
    <div style={{ background: "#f8fafc", minHeight: "100vh" }} className="p-4 sm:p-6 md:p-8">
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ marginBottom: 32 }}>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-3 mb-2">
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "#2563eb", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <UserCog style={{ width: 22, height: 22, color: "#fff" }} />
            </div>
            <div>
              <h1 style={{ fontSize: 26, fontWeight: 700, color: "#0f172a", margin: 0 }}>User Management</h1>
              <p style={{ fontSize: 14, color: "#64748b", margin: 0, marginTop: 2 }}>
                {users.length} registered user{users.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
        </div>

        {error && (
          <div
            style={{
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 8,
              padding: "12px 16px",
              marginBottom: 20,
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "#dc2626",
              fontSize: 14,
            }}
          >
            <AlertCircle style={{ width: 16, height: 16, flexShrink: 0 }} />
            {error}
          </div>
        )}

        <div
          style={{
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          {users.length === 0 ? (
            <div style={{ textAlign: "center", padding: "64px 24px" }}>
              <UserCog style={{ width: 48, height: 48, color: "#cbd5e1", margin: "0 auto 12px" }} />
              <p style={{ fontSize: 14, color: "#64748b", margin: 0 }}>No users found</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
                    <th style={{ textAlign: "left", padding: "14px 16px", color: "#64748b", fontWeight: 600, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      User
                    </th>
                    <th style={{ textAlign: "left", padding: "14px 16px", color: "#64748b", fontWeight: 600, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Email
                    </th>
                    <th style={{ textAlign: "left", padding: "14px 16px", color: "#64748b", fontWeight: 600, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Role
                    </th>
                    <th style={{ textAlign: "left", padding: "14px 16px", color: "#64748b", fontWeight: 600, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Status
                    </th>
                    <th style={{ textAlign: "left", padding: "14px 16px", color: "#64748b", fontWeight: 600, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Last Updated
                    </th>
                    <th style={{ textAlign: "right", padding: "14px 16px", color: "#64748b", fontWeight: 600, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr
                      key={u.uid}
                      style={{
                        borderBottom: "1px solid #f1f5f9",
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <td style={{ padding: "14px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: "50%",
                              background: u.role === "admin" ? "rgba(37,99,235,0.1)" : "rgba(100,116,139,0.1)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 14,
                              fontWeight: 700,
                              color: u.role === "admin" ? "#2563eb" : "#64748b",
                              flexShrink: 0,
                            }}
                          >
                            {(u.displayName || u.email || "?").charAt(0).toUpperCase()}
                          </div>
                          {editing === u.uid ? (
                            <input
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              style={{
                                background: "#fff",
                                border: "1px solid #cbd5e1",
                                borderRadius: 6,
                                padding: "6px 10px",
                                fontSize: 14,
                                color: "#0f172a",
                                outline: "none",
                                width: 140,
                                height: 40,
                              }}
                            />
                          ) : (
                            <span style={{ color: "#0f172a", fontWeight: 500 }}>{u.displayName || "—"}</span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: "14px 16px", color: "#475569" }}>{u.email}</td>
                      <td style={{ padding: "14px 16px" }}>
                        {editing === u.uid ? (
                          <select
                            value={editRole}
                            onChange={(e) => setEditRole(e.target.value as "admin" | "user")}
                            style={{
                              background: "#fff",
                              border: "1px solid #cbd5e1",
                              borderRadius: 6,
                              padding: "6px 10px",
                              fontSize: 14,
                              color: "#0f172a",
                              outline: "none",
                              height: 40,
                            }}
                          >
                            <option value="admin">Admin</option>
                            <option value="user">User</option>
                          </select>
                        ) : (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              padding: "3px 10px",
                              borderRadius: 20,
                              fontSize: 12,
                              fontWeight: 600,
                              background: u.role === "admin" ? "rgba(220,38,38,0.1)" : "rgba(37,99,235,0.1)",
                              color: u.role === "admin" ? "#dc2626" : "#2563eb",
                            }}
                          >
                            <Shield style={{ width: 12, height: 12 }} />
                            {u.role === "admin" ? "ADMIN" : "OPERATOR"}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "14px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              background: u.active !== false ? "#16a34a" : "#dc2626",
                              flexShrink: 0,
                            }}
                          />
                          <span style={{ fontSize: 12, color: "#475569" }}>
                            {u.active !== false ? "Active" : "Inactive"}
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: "14px 16px", color: "#64748b", fontSize: 12 }}>
                        {formatDateTime(u.updatedAt)}
                      </td>
                      <td style={{ padding: "14px 16px", textAlign: "right" }}>
                        {editing === u.uid ? (
                          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                            <button
                              onClick={() => handleSave(u.uid)}
                              style={{
                                background: "#16a34a",
                                color: "#fff",
                                border: "none",
                                borderRadius: 6,
                                padding: "6px 14px",
                                fontSize: 13,
                                fontWeight: 600,
                                cursor: "pointer",
                                transition: "background 0.15s",
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = "#15803d")}
                              onMouseLeave={(e) => (e.currentTarget.style.background = "#16a34a")}
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditing(null)}
                              style={{
                                background: "transparent",
                                color: "#64748b",
                                border: "1px solid #e2e8f0",
                                borderRadius: 6,
                                padding: "6px 14px",
                                fontSize: 13,
                                fontWeight: 500,
                                cursor: "pointer",
                                transition: "background 0.15s",
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                            <button
                              onClick={() => startEdit(u)}
                              style={{
                                background: "transparent",
                                color: "#2563eb",
                                border: "1px solid #e2e8f0",
                                borderRadius: 6,
                                padding: "6px 14px",
                                fontSize: 13,
                                fontWeight: 500,
                                cursor: "pointer",
                                transition: "background 0.15s",
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = "#eff6ff")}
                              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleToggleRole(u)}
                              style={{
                                background: u.role === "admin" ? "rgba(217,119,6,0.08)" : "rgba(37,99,235,0.08)",
                                color: u.role === "admin" ? "#d97706" : "#2563eb",
                                border: "none",
                                borderRadius: 6,
                                padding: "6px 14px",
                                fontSize: 13,
                                fontWeight: 500,
                                cursor: "pointer",
                                transition: "background 0.15s",
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = u.role === "admin" ? "rgba(217,119,6,0.15)" : "rgba(37,99,235,0.15)")}
                              onMouseLeave={(e) => (e.currentTarget.style.background = u.role === "admin" ? "rgba(217,119,6,0.08)" : "rgba(37,99,235,0.08)")}
                            >
                              {u.role === "admin" ? "Demote" : "Promote"}
                            </button>
                            <button
                              onClick={() => handleToggleActive(u)}
                              style={{
                                background: u.active !== false ? "rgba(220,38,38,0.08)" : "rgba(22,163,74,0.08)",
                                color: u.active !== false ? "#dc2626" : "#16a34a",
                                border: "none",
                                borderRadius: 6,
                                padding: "6px 14px",
                                fontSize: 13,
                                fontWeight: 500,
                                cursor: "pointer",
                                transition: "background 0.15s",
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = u.active !== false ? "rgba(220,38,38,0.15)" : "rgba(22,163,74,0.15)")}
                              onMouseLeave={(e) => (e.currentTarget.style.background = u.active !== false ? "rgba(220,38,38,0.08)" : "rgba(22,163,74,0.08)")}
                            >
                              {u.active !== false ? "Deactivate" : "Activate"}
                            </button>
                            <button
                              onClick={() => handleDelete(u.uid)}
                              disabled={deleting === u.uid}
                              style={{
                                background: deleting === u.uid ? "#f1f5f9" : "rgba(220,38,38,0.08)",
                                color: "#dc2626",
                                border: "none",
                                borderRadius: 6,
                                padding: "6px 14px",
                                fontSize: 13,
                                fontWeight: 500,
                                cursor: deleting === u.uid ? "not-allowed" : "pointer",
                                transition: "background 0.15s",
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              {deleting === u.uid && <Loader2 className="animate-spin" style={{ width: 12, height: 12 }} />}
                              Delete
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
