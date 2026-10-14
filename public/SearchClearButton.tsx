// The × that empties the search input right before it; CSS hides it while the input is empty.
export function SearchClearButton() {
  return (
    <button
      type="button"
      class="search-clear"
      aria-label="Clear search"
      // Keeps focus in the input, so a phone's keyboard stays open for the next search.
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        const input = e.currentTarget.previousElementSibling as HTMLInputElement;
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      }}
    >
      ×
    </button>
  );
}
