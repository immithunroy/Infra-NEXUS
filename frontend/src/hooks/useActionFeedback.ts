import { useState, useCallback } from "react";

interface ActionResult {
  message: string;
  ok: boolean;
}

interface ActionFeedback {
  result: ActionResult | null;
  setResult: (r: ActionResult | null) => void;
  execute: <T>(fn: () => Promise<T>, opts?: { successMsg?: string; errorMsg?: string }) => Promise<T | null>;
}

export function useActionFeedback(): ActionFeedback {
  const [result, setResult] = useState<ActionResult | null>(null);

  const execute = useCallback(async <T,>(
    fn: () => Promise<T>,
    opts?: { successMsg?: string; errorMsg?: string }
  ): Promise<T | null> => {
    try {
      const data = await fn();
      if (opts?.successMsg) setResult({ message: opts.successMsg, ok: true });
      return data;
    } catch (err) {
      const msg = opts?.errorMsg || (err instanceof Error ? err.message : "Operation failed");
      setResult({ message: msg, ok: false });
      return null;
    }
  }, []);

  return { result, setResult, execute };
}
