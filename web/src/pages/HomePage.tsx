import { Disc3 } from "lucide-react";
import { displayName, useMe } from "../account/me";
import { useI18n } from "../i18n";
import { EmptyState } from "../ui/EmptyState";
import { PageHeader } from "../ui/PageHeader";

type PartOfDay = "morning" | "afternoon" | "evening" | "night";

function partOfDay(date: Date): PartOfDay {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 23) return "evening";
  return "night";
}

// The catalogue (new albums, picks) arrives in stage 3.
export function HomePage() {
  const { t } = useI18n();
  const me = useMe();
  if (!me) return null;
  return (
    <>
      <PageHeader
        title={t.home.greeting[partOfDay(new Date())](displayName(me))}
        documentTitle={t.nav.home}
      />
      <EmptyState icon={Disc3} title={t.home.soonTitle}>
        {t.home.soonText}
      </EmptyState>
    </>
  );
}
