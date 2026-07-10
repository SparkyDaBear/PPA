type ListSearchOptions = {
  inputId: string;
  rowSelector: string;
  statusId: string;
  entityPlural: string;
};

export function initListSearch(options: ListSearchOptions) {
  const bind = () => {
    const input = document.getElementById(options.inputId) as HTMLInputElement | null;
    if (!input || input.dataset.searchBound === '1') {
      return;
    }

    const status = document.getElementById(options.statusId);
    const rows = Array.from(document.querySelectorAll<HTMLElement>(options.rowSelector));
    const total = rows.length;

    const renderStatus = (visibleCount: number, needle: string) => {
      if (!status) {
        return;
      }
      status.textContent = needle
        ? `${visibleCount} of ${total} ${options.entityPlural} match "${needle}"`
        : `${total} ${options.entityPlural}`;
    };

    const applyFilter = () => {
      const needle = input.value.trim().toLowerCase();
      let visibleCount = 0;

      for (const row of rows) {
        const haystack = (row.dataset.search ?? '').toLowerCase();
        const isVisible = !needle || haystack.includes(needle);
        row.hidden = !isVisible;
        if (isVisible) {
          visibleCount += 1;
        }
      }

      renderStatus(visibleCount, needle);
    };

    input.dataset.searchBound = '1';
    input.addEventListener('input', applyFilter);
    applyFilter();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }

  document.addEventListener('astro:page-load', bind);
}
