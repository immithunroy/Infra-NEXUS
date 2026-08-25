import { useEffect, useState } from "react";
import { api } from "../api/client";
import { UserOut } from "../api/types";

let cached: UserOut | null | undefined;
let promise: Promise<UserOut | null> | null = null;

export function useUserRole(): { user: UserOut | null; role: string } {
  const [user, setUser] = useState<UserOut | null>(cached ?? null);

  useEffect(() => {
    if (cached !== undefined) {
      setUser(cached);
      return;
    }
    if (!promise) {
      promise = api.get<UserOut>("/auth/me").then((u) => {
        cached = u;
        return u;
      }).catch(() => {
        cached = null;
        return null;
      });
    }
    promise.then((u) => setUser(u));
  }, []);

  return { user, role: user?.role || "" };
}
