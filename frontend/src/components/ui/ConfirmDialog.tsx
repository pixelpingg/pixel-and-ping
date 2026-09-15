import { Modal } from "./Modal";
import { Button } from "./Button";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message?: string;
  loading?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="flex gap-3 items-start mb-6">
        <div className="h-9 w-9 rounded-lg bg-signal-rose/10 text-signal-rose flex items-center justify-center shrink-0">
          <AlertTriangle size={18} />
        </div>
        <p className="text-sm text-slate-300">{message ?? t("common.confirmDelete")}</p>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="danger" onClick={onConfirm} loading={loading}>{t("common.confirm")}</Button>
      </div>
    </Modal>
  );
}
