import React, { useMemo, useState } from "react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileUp,
  KeyRound,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCcw,
  ClipboardCheck,
  Download,
  Sparkles,
} from "lucide-react";

GlobalWorkerOptions.workerSrc = workerSrc;

/* -------------------- Text canonicalize + parse -------------------- */
function canonicalizeQuizText(input) {
  let s = (input || "");
  s = s.replace(/\r/g, "\n");
  s = s.replace(/\[\s*<br>\s*\]/gi, "\n");

  // "C. âu" -> "Câu"
  s = s.replace(/C\s*[\.\,\:\-]\s*âu/gi, "Câu");

  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/\n{3,}/g, "\n\n");

  // newline trước "Câu n"
  s = s.replace(/\s*(Câu)\s*(\d+)\s*[:\.\-]?\s*/gi, (m, p1, p2) => `\nCâu ${p2}: `);

  // newline trước option a/b/c/d kể cả nằm giữa dòng + chuẩn hoá thành A./B./C./D.
  s = s.replace(/(^|[\n ]+)([a-dA-D])\s*[\)\.\:\-]\s*(?=\S)/g, (m, pre, letter) => {
    return `\n${letter.toUpperCase()}. `;
  });

  // option thiếu dấu: "b Nội dung", "c USB"
  s = s.replace(/(^|[\n ]+)([a-dA-D])\s+(?=\S)/g, (m, pre, letter) => {
    return `\n${letter.toUpperCase()}. `;
  });

  // remove dòng tiêu đề chương/phần
  s = s
    .split("\n")
    .map((x) => x.trim())
    .filter((line) => {
      if (!line) return false;
      if (/^CHƯƠNG\s*\d+/i.test(line)) return false;
      if (/^Phần\s+/i.test(line)) return false;
      return true;
    })
    .join("\n");

  s = s.replace(/\n{2,}/g, "\n").trim();
  return s;
}

function parseQuestionsFromText(rawText) {
  const text = canonicalizeQuizText(rawText);
  const blocks = text.split(/(?=^Câu\s*\d+\:\s)/gim);

  const questions = [];
  const headRe = /^Câu\s*(\d+)\:\s*([\s\S]*)$/i;
  const optRe = /^([A-D])\.\s*(.+)$/i;

  for (const blockRaw of blocks) {
    const block = blockRaw.trim();
    if (!block) continue;

    const mh = block.match(headRe);
    if (!mh) continue;

    const number = Number(mh[1]);
    const body = (mh[2] || "").trim();

    const lines = body.split("\n").map((x) => x.trim()).filter(Boolean);

    let promptLines = [];
    let options = [];
    let inOptions = false;

    for (const line of lines) {
      const mo = line.match(optRe);
      if (mo) {
        inOptions = true;
        options.push({ key: mo[1].toUpperCase(), text: mo[2].trim() });
      } else {
        if (!inOptions) promptLines.push(line);
        else if (options.length) {
          options[options.length - 1].text =
            (options[options.length - 1].text + " " + line).trim();
        }
      }
    }

    const prompt = promptLines.join(" ").trim() || "(Không tách được đề câu hỏi)";

    questions.push({
      id: String(number),
      number,
      prompt,
      options,
      correct: null,
    });
  }

  return questions;
}

/* -------------------- PDF / Answer key helpers -------------------- */
async function extractTextFromPdf(file) {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;

  let fullText = "";
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = content.items.map((it) => it.str).join(" ");
    fullText += pageText + "\n\n";
  }
  return fullText;
}

function isValidChoice(x) {
  return typeof x === "string" && /^[A-E]$/i.test(x.trim());
}

async function importAnswerKeyFromJsonFile(file, questions) {
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("File JSON không hợp lệ (parse lỗi).");
  }

  const numberToId = new Map();
  questions.forEach((q, idx) => {
    const n = Number(q.number || idx + 1);
    if (!Number.isNaN(n)) numberToId.set(n, q.id);
  });

  const keyById = {};

  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const [k, v] of Object.entries(data)) {
      const num = Number(k);
      if (Number.isNaN(num)) continue;
      if (!isValidChoice(v)) continue;

      const qid = numberToId.get(num);
      if (qid) keyById[qid] = String(v).toUpperCase().trim();
    }
    return keyById;
  }

  if (Array.isArray(data)) {
    for (const item of data) {
      const num = Number(item?.number);
      const ans = item?.answer;
      if (Number.isNaN(num)) continue;
      if (!isValidChoice(ans)) continue;

      const qid = numberToId.get(num);
      if (qid) keyById[qid] = String(ans).toUpperCase().trim();
    }
    return keyById;
  }

  throw new Error("JSON không đúng format (cần object hoặc array).");
}

/* -------------------- UI helpers -------------------- */
function cx(...arr) {
  return arr.filter(Boolean).join(" ");
}

function Button({ variant = "primary", leftIcon, className, children, ...props }) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed";
  const styles = {
    primary: "bg-slate-900 text-white hover:bg-slate-800 shadow-sm",
    secondary: "bg-white text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50",
    ghost: "bg-transparent text-slate-700 hover:bg-slate-100",
  };
  return (
    <button className={cx(base, styles[variant], className)} {...props}>
      {leftIcon ? <span className="text-base">{leftIcon}</span> : null}
      {children}
    </button>
  );
}

function Card({ className, children }) {
  return (
    <div className={cx("rounded-2xl bg-white shadow-sm ring-1 ring-slate-200", className)}>
      {children}
    </div>
  );
}

function Stat({ label, value, icon }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-slate-500">{label}</div>
          <div className="mt-1 text-2xl font-extrabold">{value}</div>
        </div>
        <div className="rounded-xl bg-slate-50 p-2 ring-1 ring-slate-200 text-slate-700">
          {icon}
        </div>
      </div>
    </Card>
  );
}

function Alert({ tone = "info", title, icon, children }) {
  const tones = {
    info: "bg-sky-50 ring-sky-200 text-sky-900",
    warn: "bg-amber-50 ring-amber-200 text-amber-900",
    danger: "bg-rose-50 ring-rose-200 text-rose-900",
    success: "bg-emerald-50 ring-emerald-200 text-emerald-900",
  };
  return (
    <div className={cx("rounded-2xl p-4 ring-1", tones[tone])}>
      <div className="flex gap-3">
        {icon ? <div className="mt-0.5">{icon}</div> : null}
        <div>
          {title && <div className="font-extrabold">{title}</div>}
          <div className={cx(title ? "mt-1" : "", "text-sm opacity-90")}>{children}</div>
        </div>
      </div>
    </div>
  );
}

/* -------------------- App -------------------- */
export default function App() {
  const [fileName, setFileName] = useState("");
  const [rawText, setRawText] = useState("");
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(false);

  const [answers, setAnswers] = useState({});
  const [answerKey, setAnswerKey] = useState({});
  const [mode, setMode] = useState("quiz"); // quiz | key
  const [submitted, setSubmitted] = useState(false);

  const keyedCount = useMemo(
    () => questions.filter((q) => answerKey[q.id]).length,
    [questions, answerKey]
  );

  const canScore = keyedCount > 0;

  const score = useMemo(() => {
    if (!submitted || !canScore) return null;
    let correctCount = 0;
    let totalKeyed = 0;
    for (const q of questions) {
      const key = answerKey[q.id];
      if (!key) continue;
      totalKeyed++;
      if ((answers[q.id] || "").toUpperCase() === key.toUpperCase()) correctCount++;
    }
    return { correctCount, totalKeyed };
  }, [submitted, canScore, questions, answers, answerKey]);

  const onUploadPdf = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;

    setSubmitted(false);
    setAnswers({});
    setAnswerKey({});
    setQuestions([]);
    setRawText("");
    setFileName(f.name);

    try {
      setLoading(true);
      const text = await extractTextFromPdf(f);
      const cleaned = canonicalizeQuizText(text);
      setRawText(cleaned);
      const qs = parseQuestionsFromText(cleaned);
      setQuestions(qs);
      setMode("quiz");
    } catch (err) {
      console.error(err);
      alert("Không đọc được PDF. Nếu PDF là scan ảnh thì cần OCR.");
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  };

  const onUploadKeyJson = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const imported = await importAnswerKeyFromJsonFile(f, questions);
      setAnswerKey(imported);
      setSubmitted(false);
      alert(`Import đáp án OK: ${Object.keys(imported).length} câu.`);
    } catch (err) {
      console.error(err);
      alert(err?.message || "Import đáp án thất bại.");
    } finally {
      e.target.value = "";
    }
  };

  const exportAnswerKey = () => {
    const out = {};
    questions.forEach((q, idx) => {
      const num = String(q.number || idx + 1);
      const ans = answerKey[q.id];
      if (ans) out[num] = ans;
    });

    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "answer-key.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const setChoice = (qid, choice) => setAnswers((p) => ({ ...p, [qid]: choice }));

  const setKeyChoice = (qid, choice) => {
    setAnswerKey((prev) => {
      const next = { ...prev };
      if (!choice) delete next[qid];
      else next[qid] = choice;
      return next;
    });
  };

  const resetQuiz = () => {
    setSubmitted(false);
    setAnswers({});
  };

  const cardTone = (q) => {
    if (!submitted) return "neutral";
    const key = answerKey[q.id];
    if (!key) return "nokey";
    const sel = (answers[q.id] || "").toUpperCase();
    if (!sel) return "unanswered";
    return sel === key.toUpperCase() ? "correct" : "wrong";
  };

  const toneClass = (tone) => {
    switch (tone) {
      case "correct":
        return "ring-emerald-200 bg-emerald-50/60";
      case "wrong":
        return "ring-rose-200 bg-rose-50/70";
      case "nokey":
        return "ring-amber-200 bg-amber-50/70";
      case "unanswered":
        return "ring-slate-200 bg-slate-50";
      default:
        return "ring-slate-200 bg-white";
    }
  };

  const toneBadge = (q) => {
    if (!submitted) return null;
    const key = answerKey[q.id];
    const sel = (answers[q.id] || "").toUpperCase();

    if (!key) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
          <AlertTriangle className="h-4 w-4" /> Chưa có đáp án
        </span>
      );
    }
    if (!sel) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
          <AlertTriangle className="h-4 w-4" /> Chưa chọn
        </span>
      );
    }
    if (sel === key) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-900">
          <CheckCircle2 className="h-4 w-4" /> Đúng
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-900">
        <XCircle className="h-4 w-4" /> Sai
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="mx-auto max-w-5xl px-4 py-8">
        {/* Header */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-slate-900 p-3 text-white shadow-sm">
                <Sparkles className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
                  PDF → Trắc nghiệm
                </h1>
                <p className="text-sm text-slate-600">
                  Upload PDF đề → upload answer-key.json → làm bài & chấm điểm.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Controls */}
        <Card className="mt-6 p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="text-sm font-semibold text-slate-800">PDF đề</div>
              <div className="flex items-center gap-2">
                <FileUp className="h-5 w-5 text-slate-600" />
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={onUploadPdf}
                  className="cursor-pointer w-full rounded-xl bg-slate-50 p-2 text-sm ring-1 ring-slate-200 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-slate-800"
                />
              </div>
              {fileName && (
                <div className="text-xs text-slate-600">
                  Đã chọn: <span className="font-semibold">{fileName}</span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="text-sm font-semibold text-slate-800">Answer key (JSON)</div>
              <div className={cx("flex items-center gap-2", !questions.length && "opacity-50")}>
                <KeyRound className="h-5 w-5 text-slate-600" />
                <input
                  type="file"
                  accept="application/json,.json"
                  disabled={!questions.length}
                  onChange={onUploadKeyJson}
                  className="cursor-pointer w-full rounded-xl bg-slate-50 p-2 text-sm ring-1 ring-slate-200 file:mr-3 file:rounded-lg file:border-0 file:bg-white file:px-3 file:py-2 file:text-xs file:font-semibold file:text-slate-900 file:ring-1 file:ring-slate-200 hover:file:bg-slate-100"
                />
              </div>
              <div className="text-xs text-slate-600">
                Format: {"{ \"1\": \"A\", \"2\": \"C\" }"}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              variant={mode === "quiz" ? "primary" : "secondary"}
              onClick={() => setMode("quiz")}
              disabled={!questions.length}
              leftIcon={<ClipboardCheck className="h-4 w-4" />}
            >
              Làm bài
            </Button>
            <Button
              variant={mode === "key" ? "primary" : "secondary"}
              onClick={() => setMode("key")}
              disabled={!questions.length}
              leftIcon={<KeyRound className="h-4 w-4" />}
            >
              Thiết lập đáp án
            </Button>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              {mode === "quiz" && (
                <>
                  <Button
                    onClick={() => setSubmitted(true)}
                    disabled={!questions.length}
                    leftIcon={<CheckCircle2 className="h-4 w-4" />}
                  >
                    Nộp bài
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={resetQuiz}
                    disabled={!questions.length}
                    leftIcon={<RefreshCcw className="h-4 w-4" />}
                  >
                    Làm lại
                  </Button>
                </>
              )}
              {mode === "key" && (
                <Button
                  onClick={exportAnswerKey}
                  disabled={!questions.length}
                  leftIcon={<Download className="h-4 w-4" />}
                >
                  Export answer-key.json
                </Button>
              )}
            </div>
          </div>

          {questions.length > 0 && (
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <Stat label="Tổng câu" value={questions.length} icon={<ClipboardCheck className="h-5 w-5" />} />
              <Stat label="Có đáp án để chấm" value={keyedCount} icon={<KeyRound className="h-5 w-5" />} />
              <Stat
                label="Trạng thái"
                value={loading ? "Đang đọc…" : "Sẵn sàng"}
                icon={<Sparkles className="h-5 w-5" />}
              />
            </div>
          )}
        </Card>

        {/* Alerts */}
        <div className="mt-4 space-y-3">
          <AnimatePresence>
            {loading && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
                <Alert tone="info" title="Đang xử lý" icon={<Sparkles className="h-5 w-5" />}>
                  Đang đọc PDF và tách câu hỏi…
                </Alert>
              </motion.div>
            )}

            {!loading && rawText && questions.length === 0 && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
                <Alert tone="danger" title="Không tách được câu hỏi" icon={<XCircle className="h-5 w-5" />}>
                  PDF có thể là ảnh scan hoặc format “vỡ”. Nếu là scan, cần OCR.
                </Alert>
              </motion.div>
            )}

            {mode === "quiz" && questions.length > 0 && score && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
                <Alert tone="success" title="Kết quả" icon={<CheckCircle2 className="h-5 w-5" />}>
                  Bạn đúng <b>{score.correctCount}</b>/<b>{score.totalKeyed}</b> câu (chỉ tính câu có đáp án).
                </Alert>
              </motion.div>
            )}

            {mode === "quiz" && questions.length > 0 && !canScore && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
                <Alert tone="warn" title="Chưa có đáp án để chấm" icon={<AlertTriangle className="h-5 w-5" />}>
                  Upload <b>answer-key.json</b> hoặc qua tab <b>Thiết lập đáp án</b>.
                </Alert>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Quiz */}
        {mode === "quiz" && !loading && questions.length > 0 && (
          <div className="mt-6 space-y-4">
            {questions.map((q, idx) => {
              const tone = cardTone(q);
              const selected = (answers[q.id] || "").toUpperCase();
              const key = (answerKey[q.id] || "").toUpperCase();

              return (
                <motion.div
                  key={q.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  <div className={cx("rounded-2xl p-5 shadow-sm ring-1", toneClass(tone))}>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-base font-extrabold text-slate-900">
                        Câu {q.number || idx + 1}
                      </div>

                      {toneBadge(q)}

                      {submitted && key && (
                        <span className="ml-auto inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 text-xs font-semibold text-slate-800 ring-1 ring-slate-200">
                          Đáp án đúng: <span className="font-extrabold">{key}</span>
                        </span>
                      )}
                    </div>

                    <div className="mt-2 text-sm leading-relaxed text-slate-800">{q.prompt}</div>

                    <div className="mt-4 grid gap-2">
                      {q.options?.length ? (
                        q.options.map((opt) => {
                          const isPicked = selected === opt.key;
                          const showState = submitted && key;
                          const isOptCorrect = showState && opt.key === key;
                          const isOptWrongPicked = showState && isPicked && opt.key !== key;

                          return (
                            <label
                              key={opt.key}
                              className={cx(
                                "group flex cursor-pointer gap-3 rounded-2xl border p-3 transition",
                                "border-slate-200 bg-white/80 hover:bg-white",
                                isPicked && "border-slate-900 ring-1 ring-slate-900/10",
                                isOptCorrect && "border-emerald-300 bg-emerald-50",
                                isOptWrongPicked && "border-rose-300 bg-rose-50"
                              )}
                            >
                              <input
                                type="radio"
                                name={`q-${q.id}`}
                                value={opt.key}
                                checked={isPicked}
                                onChange={() => setChoice(q.id, opt.key)}
                                className="mt-1 h-4 w-4 accent-slate-900"
                              />
                              <div className="text-sm text-slate-800">
                                <span className="font-extrabold">{opt.key}.</span> {opt.text}
                                {isOptCorrect && submitted && (
                                  <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                                    <CheckCircle2 className="h-4 w-4" /> Đáp án đúng
                                  </span>
                                )}
                                {isOptWrongPicked && submitted && (
                                  <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-rose-700">
                                    <XCircle className="h-4 w-4" /> Bạn chọn
                                  </span>
                                )}
                              </div>
                            </label>
                          );
                        })
                      ) : (
                        <div className="text-sm text-slate-600">
                          (Không tách được option A/B/C/D cho câu này.)
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* Key editor */}
        {mode === "key" && !loading && questions.length > 0 && (
          <div className="mt-6 space-y-4">
            <Alert tone="warn" title="Thiết lập đáp án" icon={<KeyRound className="h-5 w-5" />}>
              Chọn đáp án đúng cho từng câu. Xong bấm <b>Export answer-key.json</b>.
            </Alert>

            {questions.map((q, idx) => {
              const uniq = Array.from(new Set((q.options || []).map((o) => o.key)));
              const key = answerKey[q.id] || "";

              return (
                <motion.div
                  key={q.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <Card className="p-5">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="text-base font-extrabold">Câu {q.number || idx + 1}</div>

                      <select
                        value={key}
                        onChange={(e) => setKeyChoice(q.id, e.target.value)}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900/20"
                      >
                        <option value="">(Chưa đặt)</option>
                        {uniq.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>

                      {key && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                          Đang chọn: <b>{key}</b>
                        </span>
                      )}
                    </div>

                    <div className="mt-2 text-sm text-slate-700">{q.prompt}</div>

                    {!q.options?.length && (
                      <div className="mt-3 text-sm text-slate-500">
                        Không có option để chọn (parser chưa tách được).
                      </div>
                    )}
                  </Card>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* Debug */}
        <details className="mt-8">
          <summary className="cursor-pointer select-none text-sm font-semibold text-slate-700">
            Xem text sau khi trích xuất & chuẩn hoá (debug)
          </summary>
          <pre className="mt-3 whitespace-pre-wrap rounded-2xl bg-slate-900 p-4 text-xs text-slate-100 shadow-sm">
            {rawText || "(Chưa có)"}
          </pre>
        </details>
      </div>
    </div>
  );
}
