import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useConfig, useMoney } from "../store";
import { NETWORK_LABELS, orderToken } from "../payment";

const POLL_MS = 4000;

/**
 * Where the shopper waits while approving a mobile money prompt (and where
 * Flutterwave sends them back to). It polls the server, which asks Flutterwave
 * itself, so it settles even when the webhook is slow. Flutterwave's own
 * query parameters on the way back are ignored: only the server decides.
 */
export default function OrderPayment() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const token = params.get("token") || orderToken(id);
  const money = useMoney();
  const { support_phone, whatsapp_number } = useConfig();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let timer;
    let stopped = false;
    async function tick() {
      try {
        const { order } = await api.orderPayment(id, token);
        if (stopped) return;
        setOrder(order);
        setError("");
        if (order.payment_status === "pending") timer = setTimeout(tick, POLL_MS);
      } catch (e) {
        if (stopped) return;
        setError(e.message);
        timer = setTimeout(tick, POLL_MS * 2);
      }
    }
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id, token]);

  if (!order) {
    return (
      <div className="container empty" aria-live="polite">
        {error ? (
          <>
            <h2>We can't show this payment here</h2>
            <p style={{ marginBottom: 24 }}>
              Open this page on the device you ordered from, or check your order with its number and phone.
            </p>
            <Link to="/track" className="btn btn-primary">
              Track an order
            </Link>
          </>
        ) : (
          <div className="spinner">Checking your payment…</div>
        )}
      </div>
    );
  }

  const contact = support_phone || (whatsapp_number ? `+${whatsapp_number}` : null);
  const network = NETWORK_LABELS[order.payment_network] || "mobile money";
  const state = order.payment_status;

  return (
    <div className="container empty pay-status" aria-live="polite">
      {state === "pending" && (
        <>
          <div className="pay-spinner" aria-hidden="true" />
          <h2>Approve the payment on your phone</h2>
          <p>
            We've asked {network} to charge <strong>{money(order.total_cents)}</strong> for order{" "}
            <strong>#{order.number}</strong>. Look for the prompt on your phone and enter your PIN.
          </p>
          <p className="pay-sub">
            No prompt? Open your {network} menu and look for pending approvals.{" "}
            Your items are held until{" "}
            {order.payment_expires_at ? new Date(order.payment_expires_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "the prompt expires"}.
          </p>
        </>
      )}
      {state === "paid" && (
        <>
          <h2>Payment received. Thank you, {order.customer_name.split(" ")[0]}!</h2>
          <p>
            Order <strong>#{order.number}</strong> is paid and confirmed. We'll deliver to {order.city} soon.
          </p>
          <Link to="/shop" className="btn btn-primary">
            Continue shopping
          </Link>
        </>
      )}
      {(state === "failed" || state === "expired") && (
        <>
          <h2>{state === "expired" ? "The payment timed out" : "The payment didn't go through"}</h2>
          <p>
            Nothing was taken for order #{order.number}, and it has been cancelled. You can order again and pay with
            mobile money or cash on delivery.
          </p>
          <Link to="/shop" className="btn btn-primary">
            Back to the shop
          </Link>
        </>
      )}
      {(state === "review" || state === "refund_due" || state === "refunded") && (
        <>
          <h2>We're checking your payment</h2>
          <p>
            Something about the payment for order #{order.number} needs a person to look at it. We'll be in touch
            {contact ? (
              <>
                , or call us on <a href={`tel:${contact.replace(/\s+/g, "")}`}>{contact}</a>
              </>
            ) : null}
            .
          </p>
        </>
      )}
    </div>
  );
}
