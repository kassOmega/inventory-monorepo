"use client";
import { useToast } from "@/app/components/ToastProvider";
import Loading from "@/app/components/Loading";
import api, { markHandled } from "@/lib/api";
import { useEffect, useState } from "react";

interface Props {
  onCreated: (customer: any) => void;
  onUpdated?: (customer: any) => void;
  onCancel: () => void;
  initialData?: { id: number; name: string; phone?: string } | null;
}

export default function CustomerForm({ onCreated, onUpdated, onCancel, initialData }: Props) {
  const toast = useToast();
  const isEdit = !!initialData;
  const [name, setName] = useState(initialData?.name || "");
  const [phone, setPhone] = useState(initialData?.phone || "");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initialData) {
      setName(initialData.name);
      setPhone(initialData.phone || "");
    }
  }, [initialData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isEdit) {
        const res = await api.put(`/customers/${initialData!.id}`, {
          name,
          phone: phone || undefined,
        });
        onUpdated?.(res.data);
      } else {
        const res = await api.post("/customers", {
          name,
          phone: phone || undefined,
        });
        onCreated(res.data);
      }
    } catch (err: any) {
      markHandled(err);
      toast.error(isEdit ? "Failed to update customer" : "Failed to create customer");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4">
      <div>
        <label className="block text-sm font-medium text-gray-500 mb-1">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="border p-2 rounded-lg w-full text-sm"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-500 mb-1">Phone</label>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="border p-2 rounded-lg w-full text-sm"
          placeholder="Optional"
        />
      </div>
      <div className="flex gap-2 mt-2">
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <Loading size="sm" />
              Saving...
            </span>
          ) : isEdit ? (
            "Update Customer"
          ) : (
            "Save Customer"
          )}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-300"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}