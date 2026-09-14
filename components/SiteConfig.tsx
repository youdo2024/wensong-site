"use client";
import { createContext, useContext } from "react";

export type SiteConfig = {
  shopEnabled: boolean;
  supportEnabled: boolean;
  supportHref: string;
  supportExternal: boolean;
  memberEnabled: boolean;
  /* 文章區有內容才在導覽列露出 */
  articlesEnabled: boolean;
  social: { fb: string; ig: string; yt: string };
  /* 收聽平台：沒填的不顯示 */
  platforms: { key: string; label: string; url: string }[];
};

const Ctx = createContext<SiteConfig>({
  shopEnabled: false,
  supportEnabled: false,
  supportHref: "/support",
  supportExternal: false,
  memberEnabled: false,
  articlesEnabled: false,
  social: { fb: "", ig: "", yt: "" },
  platforms: [],
});

export function SiteConfigProvider({
  value,
  children,
}: {
  value: SiteConfig;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSiteConfig() {
  return useContext(Ctx);
}
