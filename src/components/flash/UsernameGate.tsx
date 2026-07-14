import { useEffect, useState, useCallback } from "react";
import { Zap, Wallet, Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { connectWallet, USERNAME_REGEX, isMiniPay } from "@/lib/flashContract";
import { supabase } from "@/integrations/supabase/client";

interface Session { wallet: string; username: string; }

const STORAGE_KEY = "flash.session.v1";

export function UsernameGate({ children }: { children: (s: Session) => React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [wallet, setWallet] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [username, setUsername] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "available" | "taken" | "invalid">("idle");
  const [submitting, setSubmitting] = useState(false);

  // hydrate cached session
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setSession(JSON.parse(raw));
    } catch { /* ignore */ }
    setHydrated(true);
  }, []);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    try {
      const { address } = await connectWallet();
      setWallet(address);
      // check if this wallet already claimed a username
      const { data } = await supabase
        .from("usernames")
        .select("username")
        .eq("wallet_address", address.toLowerCase())
        .maybeSingle();
      if (data?.username) {
        const s: Session = { wallet: address, username: data.username };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
        setSession(s);
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to connect wallet");
    } finally {
      setConnecting(false);
    }
  }, []);

  // realtime availability check
  useEffect(() => {
    if (!username) { setStatus("idle"); return; }
    if (!USERNAME_REGEX.test(username)) { setStatus("invalid"); return; }
    setStatus("checking");
    let cancelled = false;
    const id = setTimeout(async () => {
      const lower = username.toLowerCase();
      const { data } = await supabase
        .from("usernames")
        .select("username")
        .eq("username_lower", lower)
        .maybeSingle();
      if (cancelled) return;
      setStatus(data ? "taken" : "available");
    }, 300);
    return () => { cancelled = true; clearTimeout(id); };
  }, [username]);

  const handleClaim = async () => {
    if (!wallet || status !== "available") return;
    setSubmitting(true);
    try {
      // Prove wallet ownership with a signature — no gas, no on-chain tx.
      const message = `Flash: claim @${username.toLowerCase()} for ${wallet.toLowerCase()} at ${new Date().toISOString()}`;
      toast.loading("Sign to claim…", { id: "claim" });
      const signature = (await window.ethereum!.request({
        method: "personal_sign",
        params: [message, wallet],
      })) as string;
      const { error } = await supabase.from("usernames").insert({
        wallet_address: wallet.toLowerCase(),
        username,
        username_lower: username.toLowerCase(),
        signature,
        signed_message: message,
      });
      if (error && !error.message.includes("duplicate")) throw error;
      toast.success(`Welcome, @${username}`, { id: "claim" });
      const s: Session = { wallet, username };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
      setSession(s);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Registration failed";
      toast.error(/reject|denied/i.test(msg) ? "Signature declined" : msg, { id: "claim" });
    } finally {
      setSubmitting(false);
    }
  };

  if (!hydrated) return null;
  if (session) return <>{children(session)}</>;

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="w-full max-w-md space-y-5">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 box-sm bg-[color:var(--yellow-accent)] px-3 py-1.5 text-xs font-bold uppercase tracking-wider">
            <Zap className="w-3.5 h-3.5" /> Flash · {isMiniPay() ? "MiniPay Detected" : "MiniPay Native"}
          </div>
          <h1 className="font-display text-4xl">CLAIM YOUR HANDLE</h1>
          <p className="text-sm text-muted-foreground">One signature. One identity. No gas required.</p>
        </div>

        {!wallet ? (
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="box w-full py-5 font-display text-xl bg-foreground text-background flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {connecting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wallet className="w-5 h-5" />}
            {connecting ? "CONNECTING…" : "CONNECT WALLET"}
          </button>
        ) : (
          <div className="box bg-white p-4 space-y-4">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Wallet</span>
              <span className="font-mono">{wallet.slice(0, 6)}…{wallet.slice(-4)}</span>
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider">Choose username</label>
              <div className="relative mt-1.5">
                <input
                  autoFocus
                  value={username}
                  onChange={(e) => setUsername(e.target.value.slice(0, 24))}
                  placeholder="prosper"
                  className="box-sm w-full px-3 py-3 pr-10 font-mono text-base bg-white outline-none"
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2">
                  {status === "checking" && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                  {status === "available" && <Check className="w-4 h-4 text-[color:var(--profit)]" />}
                  {(status === "taken" || status === "invalid") && <X className="w-4 h-4 text-[color:var(--loss)]" />}
                </div>
              </div>
              <div className="mt-1.5 text-xs h-4">
                {status === "available" && <span className="text-[color:var(--profit)] font-bold">✓ Available</span>}
                {status === "taken" && <span className="text-[color:var(--loss)] font-bold">✗ Taken</span>}
                {status === "invalid" && <span className="text-[color:var(--loss)] font-bold">3–24 chars · a-z 0-9 _</span>}
              </div>
            </div>
            <button
              onClick={handleClaim}
              disabled={status !== "available" || submitting}
              className="box w-full py-4 font-display text-lg bg-[color:var(--yellow-accent)] flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
              {submitting ? "CLAIMING…" : "CLAIM USERNAME"}
            </button>
            <p className="text-[10px] text-center text-muted-foreground">
              Free · wallet signature only · case-insensitive
            </p>
          </div>
        )}
      </div>
    </div>
  );
}