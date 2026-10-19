import { HardDrive, Sparkles } from "lucide-react";
import { Loader, ErrorState } from "./States";
import "./usage.css";
export interface UsageWindow { used: number; limit: number | null; remaining: number | null; resetAt: string }
export interface AccountStatus {
  onboardingCompleted: boolean;
  storage: { usedBytes: number; limitBytes: number | null; remainingBytes: number | null; overQuota: boolean };
  ai: { daily: UsageWindow; monthly: UsageWindow };
}
const megabytes = (bytes: number) => (bytes / 1e6).toLocaleString(undefined, { maximumFractionDigits: 3 });
const resetDate = (value: string) => new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export function Usage({ data, loading, error, refresh }: { data?: AccountStatus | null; loading?: boolean; error?: string; refresh?: () => void }) {
  const unlimited = data && data.storage.limitBytes === null && data.ai.daily.limit === null && data.ai.monthly.limit === null;
  return <section className="settings-card-group account-usage">
    <div className="account-usage-header"><h3 className="settings-group-header"><HardDrive size={16} className="settings-group-icon" />Cloud storage & AI usage</h3>

    </div>
    <div className="settings-feature-card account-usage-card">
      {unlimited && <div className="account-usage-development"><span>DEVELOPMENT</span><p>Cloud storage and AI limits are disabled.</p></div>}
      {loading && !data && <Loader label="Loading usage…" />}
      {error && <ErrorState message={error} retry={refresh} />}
      {data && <div className="account-usage-grid">
        <div className="account-usage-metric"><div className="account-usage-label"><HardDrive size={15} />Cloud storage</div>
          <p className="account-usage-value">{megabytes(data.storage.usedBytes)} <span>{data.storage.limitBytes === null ? "MB used" : `MB of ${megabytes(data.storage.limitBytes)} MB`}</span></p>
          {data.storage.limitBytes !== null ? <><progress max={data.storage.limitBytes} value={Math.min(data.storage.usedBytes, data.storage.limitBytes)} aria-label="Cloud storage usage" /><p className="account-usage-detail">{megabytes(data.storage.remainingBytes ?? 0)} MB available</p>
            {data.storage.usedBytes >= data.storage.limitBytes * .9 && <p className="account-usage-warning" role="status">{data.storage.overQuota || data.storage.usedBytes >= data.storage.limitBytes ? "Cloud storage full. Free up space or use local storage." : "Cloud storage is nearly full."}</p>}</> : <p className="account-usage-detail">No cloud storage cap</p>}
        </div>
        {(["daily", "monthly"] as const).map(window => { const value = data.ai[window]; return <div key={window} className="account-usage-metric"><div className="account-usage-label"><Sparkles size={15} />{window === "daily" ? "Daily AI" : "Monthly AI"}</div>
          <p className="account-usage-value">{value.used.toLocaleString()}{value.limit !== null && ` / ${value.limit}`} <span>requests</span></p>
          {value.limit !== null ? <><progress max={value.limit} value={Math.min(value.used, value.limit)} aria-label={`${window} AI usage`} /><p className="account-usage-detail">{value.remaining} remaining · Resets {resetDate(value.resetAt)}</p>
            {value.used >= value.limit * .9 && <p className="account-usage-warning" role="status">{value.remaining === 0 ? `${window === "daily" ? "Daily" : "Monthly"} allowance exhausted.` : "Approaching your limit."}</p>}</> : <p className="account-usage-detail">No request cap</p>}
        </div>; })}
      </div>}
      {data && <p className="account-usage-footnote">Chat and voice share AI usage.{!unlimited && " Allowances reset at midnight UTC."}</p>}
    </div>
  </section>;
}
