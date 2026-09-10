"use client";
import { useAuth } from "@/context/AuthContext";
import Loading from "@/app/components/Loading";
import api from "@/lib/api";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export default function ProfilePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState("");

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [pwMsg, setPwMsg] = useState("");
  const [pwSuccess, setPwSuccess] = useState(false);

  useEffect(() => {
    api.get("/auth/profile").then(r => {
      setProfile(r.data);
      setName(r.data.name);
      setEmail(r.data.email);
      setPhone(r.data.phone || "");
    });
  }, []);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.put("/auth/profile", { name, email, phone });
    setEditing(false);
    setSaved(t("profile.updated"));
    setTimeout(() => setSaved(""), 2000);
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwMsg("");
    try {
      await api.put("/auth/profile/password", { currentPassword: currentPw, newPassword: newPw });
      setPwMsg(t("profile.passwordChanged"));
      setPwSuccess(true);
      setCurrentPw(""); setNewPw("");
    } catch (err: any) {
      setPwSuccess(false);
      setPwMsg(err.response?.data?.message || t("common.error"));
    }
    setTimeout(() => setPwMsg(""), 3000);
  };

  if (!profile) return <Loading className="py-24" />;

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h1 className="text-xl sm:text-2xl font-bold text-gray-800">{t("profile.title")}</h1>

      <div className="bg-white rounded-xl shadow-sm border p-6 space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-blue-600 flex items-center justify-center text-white text-xl font-bold">
            {profile.name?.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="font-semibold text-lg">{profile.name}</p>
            <p className="text-sm text-gray-500">{profile.role?.name}</p>
          </div>
        </div>

        <div className="text-sm text-gray-600 space-y-1">
          <p><span className="text-gray-400">{t("common.email")}:</span> {profile.email}</p>
          {profile.phone && <p><span className="text-gray-400">{t("common.phone")}:</span> {profile.phone}</p>}
          {profile.location && <p><span className="text-gray-400">{t("profile.location")}:</span> {profile.location.name}</p>}
        </div>

        <button onClick={() => setEditing(!editing)} className="text-blue-600 text-sm hover:underline">
          {editing ? t("common.cancel") : t("profile.editProfile")}
        </button>

        {editing && (
          <form onSubmit={saveProfile} className="space-y-3 pt-2 border-t">
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">{t("common.name")}</label>
              <input value={name} onChange={e => setName(e.target.value)}
                className="border p-2 rounded-lg w-full text-sm" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">{t("common.email")}</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                className="border p-2 rounded-lg w-full text-sm" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">{t("common.phone")}</label>
              <input value={phone} onChange={e => setPhone(e.target.value)}
                className="border p-2 rounded-lg w-full text-sm" />
            </div>
            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
              {t("common.save")}
            </button>
            {saved && <span className="text-green-600 text-sm ml-2">{saved}</span>}
          </form>
        )}
      </div>

      {user?.isSuperuser && (
        <div className="bg-white rounded-xl shadow-sm border p-6 space-y-4">
          <h2 className="font-semibold text-gray-800">{t("profile.changePassword")}</h2>
        <form onSubmit={changePassword} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">{t("profile.currentPassword")}</label>
            <input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)}
              className="border p-2 rounded-lg w-full text-sm" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">{t("profile.newPassword")}</label>
            <div className="relative">
              <input type={showPw ? "text" : "password"} value={newPw} onChange={e => setNewPw(e.target.value)}
                className="border p-2 rounded-lg w-full text-sm pr-10" required />
              <button type="button" onClick={() => setShowPw(!showPw)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600">
                {showPw ? t("auth.hidePassword") : t("auth.showPassword")}
              </button>
            </div>
          </div>
          <button type="submit" className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700">
            {t("profile.changePassword")}
          </button>
          {pwMsg && <span className={pwSuccess ? "text-green-600" : "text-red-500"}>{pwMsg}</span>}
        </form>
        </div>
      )}
    </div>
  );
}