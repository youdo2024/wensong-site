import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import OrderLookup from "@/components/OrderLookup";

/* 查詢表單殼頁（快取政策下放後每頁明寫） */
export const dynamic = "force-dynamic";

export const metadata: Metadata = buildMetadata({ title: "訂單查詢", path: "/orders", noindex: true });

export default function OrdersPage() {
  return (
    <>
      <Nav showCart />
      <div className="frame" style={{ padding: "48px 20px 100px" }}>
        <div className="page-head">
          <span className="tag">訂 單 查 詢</span>
          <h1>你的包裹到哪了</h1>
        </div>
        <OrderLookup />
      </div>
      <Footer />
    </>
  );
}
