"use client";
import Modal from "./Modal";
import { createContext, useCallback, useContext, useState } from "react";
import { useTranslation } from "react-i18next";

interface ConfirmState {
  message: string;
  resolve: (v: boolean) => void;
}

const ConfirmCtx = createContext<((msg: string) => Promise<boolean>) | null>(null);

export function useConfirm() {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) throw new Error("useConfirm must be inside ConfirmProvider");
  return ctx;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [state, setState] = useState<ConfirmState | null>(null);

  const confirm = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => setState({ message, resolve }));
  }, []);

  const handle = (result: boolean) => {
    state?.resolve(result);
    setState(null);
  };

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal isOpen={!!state} onClose={() => handle(false)} title={t("common.confirm")}>
        <p className="text-sm text-gray-700 mb-4">{state?.message}</p>
        <div className="flex gap-2 justify-end">
          <button onClick={() => handle(false)} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-300">{t("common.cancel")}</button>
          <button onClick={() => handle(true)} className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700">{t("common.confirm")}</button>
        </div>
      </Modal>
    </ConfirmCtx.Provider>
  );
}