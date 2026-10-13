import { Construction } from "lucide-react";
import { useI18n } from "../i18n";
import { sectionName, type SectionId } from "../shell/sections";
import { EmptyState } from "../ui/EmptyState";
import { PageHeader } from "../ui/PageHeader";

/** A section that a later stage fills in. */
export function PlaceholderPage({ section }: { section: SectionId }) {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={sectionName(t, section)} />
      <EmptyState icon={Construction} title={t.placeholder.title}>
        {t.placeholder.text}
      </EmptyState>
    </>
  );
}
