use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SearchMode {
    /// Combined Obsidian Omnisearch-style scoring across filename, tags, and content
    Omni,
    /// fzf-style fuzzy filename & relative path search
    Files,
    /// Fuzzy + substring body content search with line number & snippet
    Content,
    /// Obsidian-style #tag fuzzy filtering across all notes
    Tags,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    pub path: String,
    pub relative_path: String,
    pub title: String,
    pub snippet: String,
    pub line: Option<usize>,
    pub tags: Vec<String>,
    pub score: i64,
    pub matched_by: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TagCount {
    pub tag: String,
    pub count: usize,
}

struct IndexedDoc {
    title: String,
    relative_path: String,
    raw_content: String,
    lines: Vec<String>,
    tags: Vec<String>,
}

/// Centralized fzf-style fuzzy search & tag index shared across all Nib windows.
/// Supports 4 search modes: Omni, Files, Content, and Tags.
pub struct SearchIndex {
    docs: HashMap<PathBuf, IndexedDoc>,
    inline_tag_re: Regex,
    frontmatter_tag_re: Regex,
}

impl SearchIndex {
    pub fn new() -> Self {
        Self {
            docs: HashMap::new(),
            // Matches Obsidian-style #tag and nested #project/nib (ignoring headings / hex colors)
            inline_tag_re: Regex::new(r"(?:^|\s)#([A-Za-z0-9_\-/]+)")
                .expect("valid inline tag regex"),
            frontmatter_tag_re: Regex::new(r"(?m)^\s*-\s*([A-Za-z0-9_\-/]+)\s*$")
                .expect("valid yaml tag regex"),
        }
    }

    pub fn index_directory(&mut self, root: &Path) {
        self.walk_and_index(root, root, 0);
    }

    fn walk_and_index(&mut self, root: &Path, dir: &Path, depth: usize) {
        if depth > 12 {
            return;
        }
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || matches!(name.as_str(), "node_modules" | "target") {
                continue;
            }
            if path.is_dir() {
                self.walk_and_index(root, &path, depth + 1);
            } else if matches!(
                path.extension()
                    .and_then(|e| e.to_str())
                    .map(|s| s.to_lowercase())
                    .as_deref(),
                Some("md" | "markdown" | "mdx" | "txt")
            ) {
                if let Ok(content) = fs::read_to_string(&path) {
                    let rel = path
                        .strip_prefix(root)
                        .unwrap_or(&path)
                        .to_string_lossy()
                        .to_string();
                    self.upsert_with_rel(&path, &rel, &content);
                }
            }
        }
    }

    pub fn upsert(&mut self, path: &Path, content: &str) {
        let rel = self
            .docs
            .get(path)
            .map(|d| d.relative_path.clone())
            .unwrap_or_else(|| {
                path.file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| path.to_string_lossy().to_string())
            });
        self.upsert_with_rel(path, &rel, content);
    }

    pub fn upsert_with_rel(&mut self, path: &Path, relative_path: &str, content: &str) {
        let title = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "Untitled".to_string());
        let tags = self.extract_tags(content);
        let lines = content.lines().map(|l| l.to_string()).collect();

        self.docs.insert(
            path.to_path_buf(),
            IndexedDoc {
                title,
                relative_path: relative_path.to_string(),
                raw_content: content.to_string(),
                lines,
                tags,
            },
        );
    }

    pub fn remove(&mut self, path: &Path) {
        self.docs.remove(path);
    }

    fn extract_tags(&self, content: &str) -> Vec<String> {
        let mut set = HashSet::new();

        // 1. YAML frontmatter `tags: [a, b]` or multiline list
        if let Some(rest) = content.strip_prefix("---\n") {
            if let Some(end_idx) = rest.find("\n---") {
                let fm = &rest[..end_idx];
                if let Some(tags_pos) = fm.find("tags:") {
                    let after = &fm[tags_pos + 5..];
                    let first_line = after.lines().next().unwrap_or("").trim();
                    if first_line.starts_with('[') && first_line.ends_with(']') {
                        for item in first_line[1..first_line.len() - 1].split(',') {
                            let clean = item.trim().trim_matches(|c| c == '"' || c == '\'' || c == '#');
                            if !clean.is_empty() {
                                set.insert(clean.to_lowercase());
                            }
                        }
                    } else if !first_line.is_empty() {
                        for item in first_line.split(',') {
                            let clean = item.trim().trim_matches('#');
                            if !clean.is_empty() {
                                set.insert(clean.to_lowercase());
                            }
                        }
                    } else {
                        for cap in self.frontmatter_tag_re.captures_iter(after) {
                            if let Some(m) = cap.get(1) {
                                set.insert(m.as_str().trim_matches('#').to_lowercase());
                            }
                        }
                    }
                }
            }
        }

        // 2. Inline #tags outside fenced code blocks
        let mut in_fence = false;
        for line in content.lines() {
            let trimmed = line.trim_start();
            if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
                in_fence = !in_fence;
                continue;
            }
            if in_fence {
                continue;
            }
            for cap in self.inline_tag_re.captures_iter(line) {
                if let Some(m) = cap.get(1) {
                    let tag = m.as_str();
                    // Skip pure hex colors like #fff or #1d1d1f
                    if (tag.len() == 3 || tag.len() == 6)
                        && tag.chars().all(|c| c.is_ascii_hexdigit())
                    {
                        continue;
                    }
                    set.insert(tag.to_lowercase());
                }
            }
        }

        let mut tags: Vec<String> = set.into_iter().collect();
        tags.sort();
        tags
    }

    pub fn list_tags(&self, query: Option<&str>) -> Vec<TagCount> {
        let mut counts: HashMap<String, usize> = HashMap::new();
        for doc in self.docs.values() {
            for tag in &doc.tags {
                *counts.entry(tag.clone()).or_insert(0) += 1;
            }
        }
        let q = query.unwrap_or("").trim().trim_start_matches('#');
        let mut list: Vec<(i64, TagCount)> = counts
            .into_iter()
            .filter_map(|(tag, count)| {
                if q.is_empty() {
                    Some((count as i64, TagCount { tag, count }))
                } else {
                    fuzzy_score(q, &tag).map(|s| (s, TagCount { tag, count }))
                }
            })
            .collect();

        list.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.tag.cmp(&b.1.tag)));
        list.into_iter().map(|(_, tc)| tc).collect()
    }

    pub fn search(
        &self,
        query: &str,
        mode: SearchMode,
        tag_filter: Option<&str>,
        limit: usize,
    ) -> Vec<SearchHit> {
        let q = query.trim();
        let active_tag = tag_filter
            .map(|t| t.trim().trim_start_matches('#').to_lowercase())
            .filter(|t| !t.is_empty());

        let mut hits = Vec::new();

        for (path, doc) in &self.docs {
            // Optional tag filter (matches exact or nested prefix like #work -> #work/nib)
            if let Some(ref tf) = active_tag {
                let has_tag = doc
                    .tags
                    .iter()
                    .any(|t| t == tf || t.starts_with(&format!("{tf}/")));
                if !has_tag {
                    continue;
                }
            }

            match mode {
                SearchMode::Files => {
                    let score = if q.is_empty() {
                        Some(1)
                    } else {
                        let s_title = fuzzy_score(q, &doc.title).map(|s| s * 3);
                        let s_rel = fuzzy_score(q, &doc.relative_path).map(|s| s * 2);
                        s_title.max(s_rel)
                    };
                    if let Some(s) = score {
                        hits.push(SearchHit {
                            path: path.to_string_lossy().to_string(),
                            relative_path: doc.relative_path.clone(),
                            title: doc.title.clone(),
                            snippet: doc.relative_path.clone(),
                            line: None,
                            tags: doc.tags.clone(),
                            score: s,
                            matched_by: vec!["file".into()],
                        });
                    }
                }
                SearchMode::Content => {
                    if q.is_empty() {
                        hits.push(SearchHit {
                            path: path.to_string_lossy().to_string(),
                            relative_path: doc.relative_path.clone(),
                            title: doc.title.clone(),
                            snippet: first_preview_line(&doc.raw_content),
                            line: Some(1),
                            tags: doc.tags.clone(),
                            score: 1,
                            matched_by: vec!["content".into()],
                        });
                    } else if let Some((best_score, line_no, snippet)) = best_content_match(q, &doc.lines) {
                        hits.push(SearchHit {
                            path: path.to_string_lossy().to_string(),
                            relative_path: doc.relative_path.clone(),
                            title: doc.title.clone(),
                            snippet,
                            line: Some(line_no),
                            tags: doc.tags.clone(),
                            score: best_score,
                            matched_by: vec!["content".into()],
                        });
                    }
                }
                SearchMode::Tags => {
                    if doc.tags.is_empty() {
                        continue;
                    }
                    let tag_q = q.trim_start_matches('#');
                    let score = if tag_q.is_empty() {
                        Some(doc.tags.len() as i64)
                    } else {
                        doc.tags
                            .iter()
                            .filter_map(|t| fuzzy_score(tag_q, t))
                            .max()
                    };
                    if let Some(s) = score {
                        let snippet = doc
                            .tags
                            .iter()
                            .map(|t| format!("#{t}"))
                            .collect::<Vec<_>>()
                            .join(" ");
                        hits.push(SearchHit {
                            path: path.to_string_lossy().to_string(),
                            relative_path: doc.relative_path.clone(),
                            title: doc.title.clone(),
                            snippet,
                            line: None,
                            tags: doc.tags.clone(),
                            score: s,
                            matched_by: vec!["tag".into()],
                        });
                    }
                }
                SearchMode::Omni => {
                    if q.is_empty() {
                        hits.push(SearchHit {
                            path: path.to_string_lossy().to_string(),
                            relative_path: doc.relative_path.clone(),
                            title: doc.title.clone(),
                            snippet: first_preview_line(&doc.raw_content),
                            line: None,
                            tags: doc.tags.clone(),
                            score: 1,
                            matched_by: vec!["omni".into()],
                        });
                        continue;
                    }

                    // Support inline `#tag` tokens inside Omni queries (e.g. "#work rust")
                    let mut tag_tokens = Vec::new();
                    let mut text_tokens = Vec::new();
                    for tok in q.split_whitespace() {
                        if let Some(t) = tok.strip_prefix('#') {
                            if !t.is_empty() {
                                tag_tokens.push(t.to_lowercase());
                            }
                        } else {
                            text_tokens.push(tok);
                        }
                    }

                    // If explicit #tag tokens are present, note must fuzzy-match all of them
                    let mut total_score: i64 = 0;
                    let mut matched_by = Vec::new();
                    let mut tag_ok = true;
                    for tt in &tag_tokens {
                        if let Some(ts) = doc.tags.iter().filter_map(|t| fuzzy_score(tt, t)).max() {
                            total_score += ts * 4;
                        } else {
                            tag_ok = false;
                            break;
                        }
                    }
                    if !tag_ok {
                        continue;
                    }
                    if !tag_tokens.is_empty() {
                        matched_by.push("tag".into());
                    }

                    let text_q = text_tokens.join(" ");
                    let mut matched_line: Option<usize> = None;
                    let mut snippet = first_preview_line(&doc.raw_content);

                    if !text_q.is_empty() {
                        if let Some(fs) = fuzzy_score(&text_q, &doc.title) {
                            total_score += fs * 5;
                            matched_by.push("file".into());
                        } else if let Some(ps) = fuzzy_score(&text_q, &doc.relative_path) {
                            total_score += ps * 3;
                            matched_by.push("file".into());
                        }

                        if let Some(ts) = doc
                            .tags
                            .iter()
                            .filter_map(|t| fuzzy_score(&text_q, t))
                            .max()
                        {
                            total_score += ts * 4;
                            if !matched_by.iter().any(|m| m == "tag") {
                                matched_by.push("tag".into());
                            }
                        }

                        if let Some((cs, ln, sn)) = best_content_match(&text_q, &doc.lines) {
                            total_score += cs * 2;
                            matched_line = Some(ln);
                            snippet = sn;
                            matched_by.push("content".into());
                        }
                    }

                    if total_score > 0 {
                        hits.push(SearchHit {
                            path: path.to_string_lossy().to_string(),
                            relative_path: doc.relative_path.clone(),
                            title: doc.title.clone(),
                            snippet,
                            line: matched_line,
                            tags: doc.tags.clone(),
                            score: total_score,
                            matched_by,
                        });
                    }
                }
            }
        }

        hits.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.title.cmp(&b.title)));
        hits.truncate(limit);
        hits
    }
}

/// fzf-inspired subsequence fuzzy matcher with bonuses for consecutive chars,
/// word boundaries (`-`, `_`, `/`, ` `, camelCase), and start-of-string matches.
pub fn fuzzy_score(query: &str, target: &str) -> Option<i64> {
    let q_chars: Vec<char> = query.to_lowercase().chars().filter(|c| !c.is_whitespace()).collect();
    if q_chars.is_empty() {
        return Some(1);
    }
    let t_chars: Vec<char> = target.chars().collect();
    let t_lower: Vec<char> = target.to_lowercase().chars().collect();

    let mut qi = 0;
    let mut score: i64 = 0;
    let mut consecutive: i64 = 0;
    let mut prev_match_idx: Option<usize> = None;

    for (ti, &tc) in t_lower.iter().enumerate() {
        if qi < q_chars.len() && tc == q_chars[qi] {
            score += 16;
            if prev_match_idx.map(|p| p + 1 == ti).unwrap_or(false) {
                consecutive += 1;
                score += consecutive * 10;
            } else {
                consecutive = 0;
            }
            if ti == 0 {
                score += 24;
            } else {
                let prev = t_chars[ti - 1];
                if matches!(prev, '/' | '\\' | '-' | '_' | ' ' | '.')
                    || (prev.is_lowercase() && t_chars[ti].is_uppercase())
                {
                    score += 18;
                }
            }
            prev_match_idx = Some(ti);
            qi += 1;
        }
    }

    if qi == q_chars.len() {
        // Prefer shorter, tighter matches
        let length_penalty = (t_chars.len() as i64 - q_chars.len() as i64).max(0);
        Some((score - length_penalty).max(1))
    } else {
        None
    }
}

fn best_content_match(query: &str, lines: &[String]) -> Option<(i64, usize, String)> {
    let q_lower = query.to_lowercase();
    let mut best: Option<(i64, usize, String)> = None;

    for (idx, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        // Fast exact substring bonus + fzf subsequence fallback
        let score = if trimmed.to_lowercase().contains(&q_lower) {
            Some(120 + (q_lower.len() as i64 * 12))
        } else {
            fuzzy_score(query, trimmed)
        };

        if let Some(s) = score {
            if best.as_ref().map(|b| s > b.0).unwrap_or(true) {
                let snippet: String = trimmed.chars().take(120).collect();
                best = Some((s, idx + 1, snippet));
            }
        }
    }

    best
}

fn first_preview_line(content: &str) -> String {
    for line in content.lines() {
        let t = line.trim();
        if !t.is_empty() && t != "---" {
            return t.chars().take(100).collect();
        }
    }
    String::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_index() -> SearchIndex {
        let mut idx = SearchIndex::new();
        idx.upsert_with_rel(
            Path::new("/vault/projects/nib-architecture.md"),
            "projects/nib-architecture.md",
            "---\ntags: [rust, project/nib]\n---\n# Nib Architecture\nBuilt with Tauri v2 and CodeMirror 6.\nColor #1d1d1f should not be a tag.\n```rust\n// #not_a_tag\n```\nAlso #tauri\n",
        );
        idx.upsert_with_rel(
            Path::new("/vault/daily/2026-11-21.md"),
            "daily/2026-11-21.md",
            "# Daily Note\nTesting Cloudflare R2 WebP upload pipeline. #work #cloud\n",
        );
        idx
    }

    #[test]
    fn fuzzy_matcher_scores_subsequences_and_boundaries() {
        let s1 = fuzzy_score("nibarch", "nib-architecture").expect("should match");
        let s2 = fuzzy_score("nibarch", "xxnxxixxbxxaxxrxxcxxhxx").expect("should match");
        assert!(s1 > s2);
        assert!(fuzzy_score("zzz", "nib-architecture").is_none());
    }

    #[test]
    fn extracts_frontmatter_and_inline_tags_excluding_hex_and_code() {
        let idx = sample_index();
        let tags = idx.list_tags(None);
        let names: Vec<&str> = tags.iter().map(|t| t.tag.as_str()).collect();
        assert!(names.contains(&"rust"));
        assert!(names.contains(&"project/nib"));
        assert!(names.contains(&"tauri"));
        assert!(names.contains(&"work"));
        assert!(!names.contains(&"1d1d1f"));
        assert!(!names.contains(&"not_a_tag"));
    }

    #[test]
    fn four_search_modes_work() {
        let idx = sample_index();

        // 1. Files mode
        let files = idx.search("nibarch", SearchMode::Files, None, 10);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].title, "nib-architecture");

        // 2. Content mode (returns exact matched line)
        let content = idx.search("Cloudflare R2", SearchMode::Content, None, 10);
        assert_eq!(content.len(), 1);
        assert_eq!(content[0].title, "2026-11-21");
        assert_eq!(content[0].line, Some(2));

        // 3. Tags mode (nested prefix filter #project -> #project/nib)
        let tagged = idx.search("", SearchMode::Tags, Some("project"), 10);
        assert_eq!(tagged.len(), 1);
        assert_eq!(tagged[0].title, "nib-architecture");

        // 4. Omni mode with inline #tag + text
        let omni = idx.search("#work webp", SearchMode::Omni, None, 10);
        assert_eq!(omni.len(), 1);
        assert_eq!(omni[0].title, "2026-11-21");
    }
}
