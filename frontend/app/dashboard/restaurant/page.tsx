"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function RestaurantRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/food/orders");
  }, [router]);
  return <p className="p-8 text-gray-400">Redirecting…</p>;
}

