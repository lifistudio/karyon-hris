"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Cake } from "@/components/icons";
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, PageHeader, SkeletonList } from "@/components/ui";
import { Pagination } from "@/components/ui/Pagination";
import { api, errorMessage } from "@/lib/client-api";
import { formatDate, isoOffset, timezoneName } from "@/lib/time";

interface Person { _id: string; name: string; day: number; month: number; occurrence: string; daysAway: number; birthYear?: number; ageAtOccurrence?: number }
interface Directory { today: string; from: string; to: string; showBirthYearAndAge: boolean; total: number; items: Person[] }

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");

function whenLabel(days: number) {
  if (days === 0) return { text: "Hari ini", tone: "success" as const };
  if (days < 0) return { text: `${-days} hari lalu`, tone: "neutral" as const };
  if (days === 1) return { text: "Besok", tone: "primary" as const };
  return { text: `${days} hari lagi`, tone: "neutral" as const };
}

/**
 * Birthdays in the window chosen in Pengaturan. `compact` is the dashboard card
 * (five names and a link); the full version is the directory page.
 */
export function BirthdayPanel({ compact = false, href = "/portal/birthdays" }: { compact?: boolean; href?: string }) {
  const [data, setData] = useState<Directory | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const limit = compact ? 5 : 25;

  useEffect(() => {
    let active = true;
    api
      .get<Directory>(`/api/v1/birthdays?page=${page}&limit=${limit}`, { cache: "no-store" })
      .then((res) => { if (active) { setData(res.data ?? null); setError(""); } })
      .catch((err) => { if (active) setError(errorMessage(err)); });
    return () => { active = false; };
  }, [page, limit, retry]);

  const dayFmt = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", timeZone: timezoneName() });
  const period = data ? `${formatDate(data.from)} – ${formatDate(data.to)}` : "";

  const list = error ? (
    <Alert tone="danger" title="Daftar ulang tahun belum dapat dimuat">
      <p>{error}</p>
      <Button variant="secondary" size="sm" className="mt-3" onClick={() => setRetry((n) => n + 1)}>Coba lagi</Button>
    </Alert>
  ) : !data ? (
    <SkeletonList rows={compact ? 3 : 6} />
  ) : data.items.length === 0 ? (
    <EmptyState icon={Cake} title="Belum ada ulang tahun pada periode ini" description="Hanya karyawan aktif dengan tanggal lahir terisi yang ditampilkan." />
  ) : (
    <ul className="divide-y divide-line">
      {data.items.map((person) => {
        const when = whenLabel(person.daysAway);
        const showAge = data.showBirthYearAndAge && person.birthYear && person.ageAtOccurrence !== undefined;
        return (
          <li key={`${person._id}:${person.occurrence}`} className="flex items-center gap-3 py-3">
            <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-background-secondary-default text-body-sm font-semibold text-heading">
              {initials(person.name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-medium text-heading">{person.name}</span>
              <span className="block text-body-sm text-muted">
                {dayFmt.format(new Date(`${person.occurrence}T12:00:00${isoOffset()}`))}
                {showAge ? ` · ${person.ageAtOccurrence} tahun (lahir ${person.birthYear})` : ""}
              </span>
            </span>
            <Badge tone={when.tone} icon={person.daysAway === 0 ? Cake : undefined}>{when.text}</Badge>
          </li>
        );
      })}
    </ul>
  );

  if (compact) {
    return (
      <Card>
        <CardHeader icon={Cake} title="Ulang tahun" description={data ? `${period} · ${data.total} orang` : undefined} />
        <CardBody className="pt-0">
          {list}
          <Link href={href} className="mt-3 inline-flex items-center gap-1 text-body-sm font-medium text-primary hover:underline">
            Lihat semua <ArrowRight className="size-4" aria-hidden />
          </Link>
        </CardBody>
      </Card>
    );
  }

  return (
    <div>
      <PageHeader
        title="Ulang tahun karyawan"
        description={data ? `${period} · ${data.total} ulang tahun. Periode mengikuti pengaturan perusahaan.` : "Periode mengikuti pengaturan perusahaan."}
      />
      <Card>
        <CardBody>{list}</CardBody>
      </Card>
      {data && data.total > limit && (
        <div className="mt-4">
          <Pagination page={page} limit={limit} total={data.total} totalPages={Math.ceil(data.total / limit)} onPage={(value) => { setData(null); setPage(value); }} />
        </div>
      )}
      {data && (
        <p className="mt-4 text-body-sm text-muted">
          {data.showBirthYearAndAge ? "Tahun lahir dan usia ditampilkan sesuai pengaturan perusahaan." : "Tahun lahir dan usia disembunyikan sesuai pengaturan perusahaan."}{" "}
          Ulang tahun 29 Februari ditampilkan pada 28 Februari di tahun nonkabisat.
        </p>
      )}
    </div>
  );
}
