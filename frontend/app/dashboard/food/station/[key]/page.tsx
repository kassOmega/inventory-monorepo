"use client";
import { useParams } from "next/navigation";
import StationBoard from "@/app/components/StationBoard";

// Dynamic station board — one route for every owner-managed station
// (kitchen, bar, barista, butcher, bakery, ...).
export default function StationPage() {
  const params = useParams<{ key: string }>();
  return <StationBoard station={params.key} />;
}
