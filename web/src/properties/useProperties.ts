import { useCallback, useEffect, useState } from "react";
import type { PropertyInfo } from "@brainmd/shared/property-types";
import { api } from "../api/client";

// Vault-wide property keys, types and common values. Reloads when
// `refreshKey` changes (the open note) and on demand.
export function useProperties(refreshKey: string): { infos: PropertyInfo[]; refresh: () => void } {
  const [infos, setInfos] = useState<PropertyInfo[]>([]);
  const refresh = useCallback(() => {
    api
      .properties()
      .then(setInfos)
      .catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);
  return { infos, refresh };
}
