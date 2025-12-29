import React, { useEffect, useMemo, useRef, useState } from "react";
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
  ChevronUp,
} from "lucide-react";

GlobalWorkerOptions.workerSrc = workerSrc;

/* -------------------- Text canonicalize + parse -------------------- */
function canonicalizeQuizText(input) {
  let s = (input || "");
  s = s.replace(/\r/g, "\n");
  s = s.replace(/\[\s*<br>\s*\]/gi, "\n");
  s = s.replace(/C\s*[\.\,\:\-]\s*âu/gi, "Câu");
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/\n{3,}/g, "\n\n");
  s = s.replace(/\s*(Câu)\s*(\d+)\s*[:\.\-]?\s*/gi, (m, p1, p2) => `\nCâu ${p2}: `);

  s = s.replace(/(^|[\n ]+)([a-dA-D])\s*[\)\.\:\-]\s*(?=\S)/g, (m, pre, letter) => {
    return `\n${letter.toUpperCase()}. `;
  });
  s = s.replace(/(^|[\n ]+)([a-dA-D])\s+(?=\S)/g, (m, pre, letter) => {
    return `\n${letter.toUpperCase()}. `;
  });

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

/* -------------------- LocalStorage helpers -------------------- */
const LS_PREFIX = "pdf-quiz:v1:";

function safeParseJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
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

  const questionRefs = useRef(new Map()); // id -> element

  // --- derived stats
  const answeredCount = useMemo(
    () => questions.filter((q) => (answers[q.id] || "").trim()).length,
    [questions, answers]
  );

  const keyedCount = useMemo(
    () => questions.filter((q) => answerKey[q.id]).length,
    [questions, answerKey]
  );

  const canScore = keyedCount > 0;

  const score = useMemo(() => {
    if (!submitted || !canScore) return null;
    let correctCount = 0;
    let wrongCount = 0;
    let totalKeyed = 0;

    for (const q of questions) {
      const key = (answerKey[q.id] || "").toUpperCase();
      if (!key) continue;
      totalKeyed++;

      const sel = (answers[q.id] || "").toUpperCase();
      if (!sel) continue;

      if (sel === key) correctCount++;
      else wrongCount++;
    }
    return { correctCount, wrongCount, totalKeyed };
  }, [submitted, canScore, questions, answers, answerKey]);

  const progressPct = useMemo(() => {
    if (!questions.length) return 0;
    return Math.round((answeredCount / questions.length) * 100);
  }, [questions.length, answeredCount]);

  // --- autosave per fileName
  const storageKey = useMemo(() => {
    return fileName ? `${LS_PREFIX}${fileName}` : "";
  }, [fileName]);

  useEffect(() => {
    if (!storageKey) return;
    const saved = safeParseJson(localStorage.getItem(storageKey) || "");
    if (!saved) return;

    // restore only if question count matches-ish OR just restore anyway (soft restore)
    setAnswers(saved.answers || {});
    setAnswerKey(saved.answerKey || {});
    setMode(saved.mode || "quiz");
    setSubmitted(Boolean(saved.submitted));
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    const payload = {
      answers,
      answerKey,
      mode,
      submitted,
      ts: Date.now(),
    };
    localStorage.setItem(storageKey, JSON.stringify(payload));
  }, [storageKey, answers, answerKey, mode, submitted]);

  const onUploadPdf = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;

    // reset state for new pdf
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

  const scrollToQuestion = (qid) => {
    const el = questionRefs.current.get(qid);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const goTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  const statusOf = (q) => {
    const key = (answerKey[q.id] || "").toUpperCase();
    const sel = (answers[q.id] || "").toUpperCase();

    if (!submitted) {
      if (sel) return "answered";
      return "unanswered";
    }

    if (!key) return sel ? "answered_nokey" : "nokey";
    if (!sel) return "unanswered_keyed";
    return sel === key ? "correct" : "wrong";
  };

  const navColor = (st) => {
    switch (st) {
      case "correct":
        return "bg-emerald-600 text-white";
      case "wrong":
        return "bg-rose-600 text-white";
      case "answered_nokey":
      case "nokey":
        return "bg-amber-500 text-white";
      case "answered":
        return "bg-slate-900 text-white";
      case "unanswered_keyed":
        return "bg-slate-200 text-slate-800";
      default:
        return "bg-white text-slate-800 ring-1 ring-slate-200 hover:bg-slate-50";
    }
  };

  const cardRing = (st) => {
    switch (st) {
      case "correct":
        return "ring-emerald-200 bg-emerald-50/60";
      case "wrong":
        return "ring-rose-200 bg-rose-50/70";
      case "answered_nokey":
      case "nokey":
        return "ring-amber-200 bg-amber-50/70";
      case "unanswered_keyed":
        return "ring-slate-200 bg-slate-50";
      case "answered":
        return "ring-slate-200 bg-white";
      default:
        return "ring-slate-200 bg-white";
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Header */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-slate-900 p-3 text-white shadow-sm">
                <Sparkles className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
                  PDF → Trắc nghiệm (Pro UI/UX)
                </h1>
                <p className="text-sm text-slate-600">
                  Có progress, điều hướng câu, tự lưu bài làm.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {fileName ? (
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                  {fileName}
                </span>
              ) : (
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                  Tailwind + Motion + Icons
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Layout: left content + right sidebar */}
        <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_360px]">
          {/* LEFT */}
          <div className="space-y-4">
            {/* Controls */}
            <Card className="p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <div className="text-sm font-semibold text-slate-800">PDF đề</div>
                  <div className="flex items-center gap-2">
                    <FileUp className="h-5 w-5 text-slate-600" />
                    <input
                      type="file"
                      accept="application/pdf"
                      onChange={onUploadPdf}
                      className="w-full rounded-xl bg-slate-50 p-2 text-sm ring-1 ring-slate-200 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-slate-800"
                    />
                  </div>
                  <div className="text-xs text-slate-500">
                    Tip: reload vẫn giữ bài (auto-save theo tên file).
                  </div>
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
                      className="w-full rounded-xl bg-slate-50 p-2 text-sm ring-1 ring-slate-200 file:mr-3 file:rounded-lg file:border-0 file:bg-white file:px-3 file:py-2 file:text-xs file:font-semibold file:text-slate-900 file:ring-1 file:ring-slate-200 hover:file:bg-slate-100"
                    />
                  </div>
                  <div className="text-xs text-slate-500">
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

              {/* Progress */}
              {questions.length > 0 && mode === "quiz" && (
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
                    <span>
                      Tiến độ: <span className="text-slate-900">{answeredCount}/{questions.length}</span>
                    </span>
                    <span>{progressPct}%</span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200">
                    <motion.div
                      className="h-full bg-slate-900"
                      initial={{ width: 0 }}
                      animate={{ width: `${progressPct}%` }}
                      transition={{ type: "spring", stiffness: 140, damping: 18 }}
                    />
                  </div>

                  {submitted && score && (
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <div className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-900 ring-1 ring-emerald-200">
                        Đúng: {score.correctCount}
                      </div>
                      <div className="rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-900 ring-1 ring-rose-200">
                        Sai: {score.wrongCount}
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-900 ring-1 ring-slate-200">
                        Có key: {score.totalKeyed}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>

            {/* Alerts */}
            <div className="space-y-3">
              <AnimatePresence>
                {loading && (
                  <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                    <Alert tone="info" title="Đang xử lý" icon={<Sparkles className="h-5 w-5" />}>
                      Đang đọc PDF và tách câu hỏi…
                    </Alert>
                  </motion.div>
                )}

                {!loading && rawText && questions.length === 0 && (
                  <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                    <Alert tone="danger" title="Không tách được câu hỏi" icon={<XCircle className="h-5 w-5" />}>
                      PDF có thể là ảnh scan hoặc format “vỡ”. Nếu là scan, cần OCR.
                    </Alert>
                  </motion.div>
                )}

                {mode === "quiz" && questions.length > 0 && submitted && !canScore && (
                  <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                    <Alert tone="warn" title="Chưa có đáp án để chấm" icon={<AlertTriangle className="h-5 w-5" />}>
                      Upload <b>answer-key.json</b> hoặc qua tab <b>Thiết lập đáp án</b>.
                    </Alert>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Content */}
            {mode === "quiz" && !loading && questions.length > 0 && (
              <div className="space-y-4">
                {questions.map((q, idx) => {
                  const st = statusOf(q);
                  const selected = (answers[q.id] || "").toUpperCase();
                  const key = (answerKey[q.id] || "").toUpperCase();

                  return (
                    <motion.div
                      key={q.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.22 }}
                      ref={(el) => {
                        if (el) questionRefs.current.set(q.id, el);
                      }}
                    >
                      <div className={cx("rounded-2xl p-5 shadow-sm ring-1", cardRing(st))}>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-base font-extrabold text-slate-900">
                            Câu {q.number || idx + 1}
                          </div>

                          {submitted && st === "correct" && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-900">
                              <CheckCircle2 className="h-4 w-4" /> Đúng
                            </span>
                          )}
                          {submitted && st === "wrong" && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-900">
                              <XCircle className="h-4 w-4" /> Sai
                            </span>
                          )}
                          {submitted && (st === "nokey" || st === "answered_nokey") && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
                              <AlertTriangle className="h-4 w-4" /> Chưa có đáp án
                            </span>
                          )}

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
                            <div className="text-sm text-slate-600">(Không tách được option A/B/C/D cho câu này.)</div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}

            {mode === "key" && !loading && questions.length > 0 && (
              <div className="space-y-4">
                <Alert tone="warn" title="Thiết lập đáp án" icon={<KeyRound className="h-5 w-5" />}>
                  Chọn đáp án đúng cho từng câu. Xong bấm <b>Export answer-key.json</b>.
                </Alert>

                {questions.map((q, idx) => {
                  const uniq = Array.from(new Set((q.options || []).map((o) => o.key)));
                  const key = answerKey[q.id] || "";

                  return (
                    <motion.div key={q.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
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

          {/* RIGHT SIDEBAR */}
          <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
            <Card className="p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-extrabold text-slate-900">Điều hướng câu</div>
                <Button variant="ghost" className="px-3 py-2" onClick={goTop} leftIcon={<ChevronUp className="h-4 w-4" />}>
                  Top
                </Button>
              </div>

              {questions.length === 0 ? (
                <div className="mt-3 text-sm text-slate-600">Upload PDF để hiện danh sách câu.</div>
              ) : (
                <>
                  <div className="mt-3 grid grid-cols-6 gap-2">
                    {questions.map((q, idx) => {
                      const st = statusOf(q);
                      return (
                        <button
                          key={q.id}
                          onClick={() => scrollToQuestion(q.id)}
                          className={cx(
                            "h-10 rounded-xl text-sm font-extrabold transition active:scale-[0.98]",
                            navColor(st)
                          )}
                          title={`Câu ${q.number || idx + 1}`}
                        >
                          {q.number || idx + 1}
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-4 space-y-2 text-xs text-slate-600">
                    <div className="flex items-center justify-between">
                      <span>Chưa làm</span>
                      <span className="inline-block h-4 w-6 rounded bg-white ring-1 ring-slate-200" />
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Đã làm (chưa nộp)</span>
                      <span className="inline-block h-4 w-6 rounded bg-slate-900" />
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Đúng</span>
                      <span className="inline-block h-4 w-6 rounded bg-emerald-600" />
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Sai</span>
                      <span className="inline-block h-4 w-6 rounded bg-rose-600" />
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Chưa có đáp án</span>
                      <span className="inline-block h-4 w-6 rounded bg-amber-500" />
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Chưa chọn (có key)</span>
                      <span className="inline-block h-4 w-6 rounded bg-slate-200" />
                    </div>
                  </div>
                </>
              )}
            </Card>

            <Card className="p-4">
              <div className="text-sm font-extrabold text-slate-900">Tự lưu bài</div>
              <div className="mt-2 text-sm text-slate-600">
                App tự lưu đáp án bạn chọn + key theo <b>tên file PDF</b>. Nếu muốn reset hẳn, đổi tên PDF hoặc bấm “Làm lại”.
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
