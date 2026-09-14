"use client";
import { createContext, useContext, useEffect, useState } from "react";

export type CartItem = {
  key: string;
  id: number;
  name: string;
  choice: string | null;
  price: number;
  qty: number;
  img?: string;
};

type CartCtx = {
  cart: CartItem[];
  add: (item: Omit<CartItem, "key">) => void;
  setQty: (key: string, qty: number) => void;
  remove: (key: string) => void;
  clear: () => void;
  count: number;
};

const Ctx = createContext<CartCtx | null>(null);
const LS_KEY = "yo_cart";

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as CartItem[] | { at?: number; items?: CartItem[] };
        /* 30 天 TTL：太舊的購物車整車丟掉。躺三個月的出貨週早就截止了，
           留著只會讓人結帳時撞牆。舊格式（純陣列，沒有時間戳）視為過期起算今天。 */
        const items = Array.isArray(parsed) ? parsed : parsed.items || [];
        const at = Array.isArray(parsed) ? Date.now() : Number(parsed.at) || 0;
        if (Date.now() - at < 30 * 24 * 3600 * 1000) setCart(items);
        else localStorage.removeItem(LS_KEY);
      }
    } catch {}
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) localStorage.setItem(LS_KEY, JSON.stringify({ at: Date.now(), items: cart }));
  }, [cart, loaded]);

  const add: CartCtx["add"] = (item) => {
    const key = `${item.id}|${item.choice ?? ""}`;
    setCart((c) => {
      const ex = c.find((i) => i.key === key);
      if (ex) return c.map((i) => (i.key === key ? { ...i, qty: i.qty + item.qty } : i));
      return [...c, { ...item, key }];
    });
  };
  const setQty = (key: string, qty: number) =>
    setCart((c) => c.map((i) => (i.key === key ? { ...i, qty: Math.max(1, qty) } : i)));
  const remove = (key: string) => setCart((c) => c.filter((i) => i.key !== key));
  const clear = () => setCart([]);
  const count = cart.reduce((s, i) => s + i.qty, 0);

  return <Ctx.Provider value={{ cart, add, setQty, remove, clear, count }}>{children}</Ctx.Provider>;
}

export function useCart() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
