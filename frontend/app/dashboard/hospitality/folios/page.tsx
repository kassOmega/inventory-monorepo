"use client";

// Unified folio surface: in-house stays (room folio + linked package guests on
// one consolidated bill) and package guests. The panel reads `?reservation=`
// from the URL, so it lives behind a Suspense boundary.

import { Suspense } from "react";
import FoliosPanel from "@/app/components/FoliosPanel";
import Loading from "@/app/components/Loading";

export default function FoliosPage() {
  return (
    <Suspense fallback={<Loading className="py-24" />}>
      <FoliosPanel />
    </Suspense>
  );
}
