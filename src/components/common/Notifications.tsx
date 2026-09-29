import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";

type NotificationIntent = "success" | "error" | "info";
interface NotificationItem {
  id: number;
  message: string;
  intent: NotificationIntent;
}

const NotificationContext = createContext<
  ((message: string, intent?: NotificationIntent) => void) | null
>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const nextId = useRef(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const notify = useCallback(
    (message: string, intent: NotificationIntent = "info") => {
      const id = ++nextId.current;
      setItems((current) => [...current.slice(-2), { id, message, intent }]);
      window.setTimeout(
        () => setItems((current) => current.filter((item) => item.id !== id)),
        4200,
      );
    },
    [],
  );

  return (
    <NotificationContext.Provider value={notify}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {items.map((item) => (
          <div
            key={item.id}
            role={item.intent === "error" ? "alert" : "status"}
            className={`pointer-events-auto rounded-xl border px-3 py-2.5 text-sm font-medium shadow-xl backdrop-blur-md ${
              item.intent === "success"
                ? "border-emerald-300 bg-emerald-50/95 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/95 dark:text-emerald-100"
                : item.intent === "error"
                  ? "border-red-300 bg-red-50/95 text-red-900 dark:border-red-900 dark:bg-red-950/95 dark:text-red-100"
                  : "border-slate-200 bg-white/95 text-slate-800 dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100"
            }`}
          >
            {item.message}
          </div>
        ))}
      </div>
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const notify = useContext(NotificationContext);
  if (!notify)
    throw new Error(
      "useNotifications must be used within NotificationsProvider",
    );
  return notify;
}
