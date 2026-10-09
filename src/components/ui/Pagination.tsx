
const PAGE_WINDOW_SIZE = 5;

function getVisiblePages(pageCount: number, currentPage: number) {
    if (pageCount <= PAGE_WINDOW_SIZE + 2) {
        return Array.from({ length: pageCount }, (_, index) => index);
    }

    if (currentPage < PAGE_WINDOW_SIZE - 1) {
        return [...Array.from({ length: PAGE_WINDOW_SIZE + 1 }, (_, index) => index), "ellipsis-end", pageCount - 1] as const;
    }

    const firstVisiblePage = Math.min(currentPage - 2, pageCount - PAGE_WINDOW_SIZE);
    const lastVisiblePage = firstVisiblePage + PAGE_WINDOW_SIZE - 1;
    const pages: Array<number | "ellipsis-start" | "ellipsis-end"> = [0];

    if (firstVisiblePage > 1) pages.push("ellipsis-start");
    for (let page = firstVisiblePage; page <= lastVisiblePage; page += 1) pages.push(page);
    if (lastVisiblePage < pageCount - 2) pages.push("ellipsis-end");
    if (lastVisiblePage < pageCount - 1) pages.push(pageCount - 1);

    return pages;
}

export function Pagination({
    pageCount,
    currentPage,
    onPageChange,
    label,
}: {
    pageCount: number;
    currentPage: number;
    onPageChange: (page: number) => void;
    label: string;
}) {
    if (pageCount <= 1) return null;

    return (
        <section className="pagination-section" aria-label={`${label} pagination`}>
            <nav className="pagination" aria-label={`${label} pages`}>
                <button
                    className="pagination-arrow"
                    type="button"
                    aria-label={`Previous ${label.toLowerCase()} page`}
                    disabled={currentPage === 0}
                    onClick={() => onPageChange(currentPage - 1)}
                >
                    ‹
                </button>
                <div className="pagination-pages">
                    {getVisiblePages(pageCount, currentPage).map((page) =>
                        typeof page === "number" ? (
                            <button
                                key={page}
                                className="pagination-page"
                                type="button"
                                aria-label={`Show ${label.toLowerCase()} page ${page + 1}`}
                                aria-current={currentPage === page ? "page" : undefined}
                                onClick={() => onPageChange(page)}
                            >
                                {page + 1}
                            </button>
                        ) : (
                            <span key={page} className="pagination-ellipsis" aria-hidden="true">…</span>
                        )
                    )}
                </div>
                <button
                    className="pagination-arrow"
                    type="button"
                    aria-label={`Next ${label.toLowerCase()} page`}
                    disabled={currentPage === pageCount - 1}
                    onClick={() => onPageChange(currentPage + 1)}
                >
                    ›
                </button>
            </nav>
        </section>
    );
}
