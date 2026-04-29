/**
 * Extract a long HTML excerpt from raw markdown body.
 * Returns the first few paragraphs/lists as rendered HTML.
 */
export function extractLongExcerpt(body: string): string {
	const lines = body.split("\n");
	const blocks: string[] = [];
	let current = "";
	let inCode = false;

	for (const line of lines) {
		// skip frontmatter
		if (blocks.length === 0 && line.trim() === "" && current === "") continue;

		if (line.startsWith("```")) {
			inCode = !inCode;
			if (!inCode && current) {
				blocks.push(current.trim());
				current = "";
				if (blocks.length >= 3) break;
			}
			continue;
		}
		if (inCode) continue;

		// heading → skip but stop collecting if we already have content
		if (/^#{1,6}\s/.test(line)) {
			if (blocks.length > 0) break;
			continue;
		}

		// table → stop
		if (/^\|/.test(line)) {
			if (blocks.length > 0) break;
			continue;
		}

		if (line.trim() === "") {
			if (current.trim()) {
				blocks.push(current.trim());
				current = "";
			}
		} else {
			current += (current ? "\n" : "") + line;
		}
	}
	if (current.trim() && blocks.length < 3) {
		blocks.push(current.trim());
	}

	return blocks.map((b) => mdBlockToHtml(b)).join("\n");
}

function mdBlockToHtml(block: string): string {
	// list block
	if (/^\d+\.\s/.test(block) || /^[-*]\s/.test(block)) {
		const isOrdered = /^\d+\.\s/.test(block);
		const tag = isOrdered ? "ol" : "ul";
		const items = block
			.split("\n")
			.filter((l) => l.trim())
			.map((l) => `<li>${inlineMd(l.replace(/^\d+\.\s|^[-*]\s/, ""))}</li>`)
			.join("\n");
		return `<${tag}>\n${items}\n</${tag}>`;
	}
	return `<p>${inlineMd(block)}</p>`;
}

function inlineMd(text: string): string {
	return text
		.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
		.replace(/`([^`]+)`/g, "<code>$1</code>")
		.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
}
