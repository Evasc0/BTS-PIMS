import { useEffect, useRef, useState } from 'react';

type QueryFn<T> = () => Promise<T> | T;

type DbChangeHandler = () => void;

const subscribeToDbChanges = (handler: DbChangeHandler) => {
  if (!window.api?.db?.onChanged) return () => undefined;
  return window.api.db.onChanged(() => handler());
};

export function useLiveQuery<T>(queryFn: QueryFn<T>, deps: unknown[] = []): T | undefined {
  const [data, setData] = useState<T>();
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;
    const runQuery = async () => {
      try {
        const result = await queryFn();
        if (activeRef.current) setData(result);
      } catch (error) {
        // Ignore transient query errors to keep UI responsive.
      }
    };

    runQuery();
    const unsubscribe = subscribeToDbChanges(runQuery);

    return () => {
      activeRef.current = false;
      unsubscribe();
    };
  }, deps);

  return data;
}
