import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  ArrowRight,
  AudioLines,
  BookOpen,
  Check,
  Code2,
  Download,
  Mail,
  Moon,
  Pause,
  Play,
  ShieldCheck,
  Sun,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { useTheme } from "@/components/theme-provider"
import { cn } from "@/lib/utils"

const releaseUrl = "https://github.com/nikitadrokin/kokoro/releases/latest"
const sourceUrl = "https://github.com/nikitadrokin/kokoro"

const features = [
  {
    icon: AudioLines,
    title: "Read anything out loud",
    description:
      "Paste a script, pick a voice, and hear it back. Nothing you write is sent to a synthesis service.",
  },
  {
    icon: BookOpen,
    title: "Get through your books",
    description:
      "Open an EPUB, pick up where you left off, and turn a long reading list into a listening queue.",
  },
  {
    icon: Mail,
    title: "Clear your inbox by ear",
    description:
      "Connect Gmail and listen to the mail that matters while Kokoro handles the narration.",
  },
]

const specs = [
  "Kokoro v1.0 voices",
  "Streaming playback, saved as WAV",
  "A native, focused Mac app",
  "Open source, built on Rust and React",
]

// Organic waveform: an arch envelope with a little jitter, computed once so
// the shape is stable between renders.
const wave = Array.from({ length: 48 }, (_, i) => {
  const t = i / 47
  const envelope = Math.sin(t * Math.PI)
  const jitter = Math.abs(Math.sin(i * 1.7) + Math.sin(i * 0.6)) / 2
  return Math.max(0.16, Math.min(1, envelope * 0.72 + jitter * 0.34 + 0.14))
})

function ThemeButton() {
  const { theme, setTheme } = useTheme()
  const isDark = theme === "dark"

  return (
    <Button
      aria-label={isDark ? "Use light theme" : "Use dark theme"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      size="icon-sm"
      variant="ghost"
    >
      {isDark ? <Sun /> : <Moon />}
    </Button>
  )
}

/** Fades + rises its children into view once, respecting reduced motion. */
function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode
  delay?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.2, rootMargin: "0px 0px -48px 0px" },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={cn("reveal", className)}
      data-visible={visible}
      style={{ "--reveal-delay": `${delay}ms` } as React.CSSProperties}
    >
      {children}
    </div>
  )
}

function WaveBars({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-full items-center gap-[3px]", className)}>
      {wave.map((height, i) => (
        <span
          key={i}
          className="flex-1 rounded-full bg-current"
          style={{ height: `${Math.round(height * 100)}%` }}
        />
      ))}
    </div>
  )
}

function AppPreview() {
  return (
    <Card className="overflow-hidden shadow-xl shadow-foreground/[0.03]">
      <CardHeader className="border-b pb-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <AudioLines aria-hidden="true" className="size-[18px]" />
          </div>
          <div className="leading-tight">
            <p className="font-medium">Speech</p>
            <p className="text-sm text-muted-foreground">Voice · Heart</p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          Read this out loud, naturally. Kokoro turns the words on your Mac into
          speech you can stream now or save for later.
        </p>

        {/* Waveform with a playhead sweeping across it. */}
        <div className="relative h-14 select-none">
          <WaveBars className="text-border" />
          <div className="waveform-fill absolute inset-0">
            <WaveBars className="text-primary" />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div
            aria-hidden="true"
            className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground"
          >
            <Play className="size-4 translate-x-px fill-current" />
          </div>
          <span className="font-mono text-sm tabular-nums text-muted-foreground">
            0:05 / 0:12
          </span>
          <div className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground">
            <ShieldCheck aria-hidden="true" className="size-4 text-primary" />
            On device
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function FeatureCard({
  icon: Icon,
  title,
  description,
}: (typeof features)[number]) {
  return (
    <Card className="card-lift h-full shadow-xs">
      <CardHeader>
        <Icon aria-hidden="true" className="mb-3 size-5 text-primary" />
        <CardTitle>{title}</CardTitle>
        <CardDescription className="leading-relaxed text-[15px]">
          {description}
        </CardDescription>
      </CardHeader>
    </Card>
  )
}

export function App() {
  const [scrolled, setScrolled] = useState(false)

  return (
    <div
      className="h-svh overflow-y-auto scroll-smooth bg-background text-foreground"
      onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 8)}
    >
      <header
        className="sticky top-0 z-20 border-b border-transparent bg-background/60 backdrop-blur-md transition-colors duration-200 data-[scrolled=true]:border-border data-[scrolled=true]:bg-background/80"
        data-scrolled={scrolled}
      >
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <a
            aria-label="Kokoro home"
            className="flex items-center gap-2 font-medium"
            href="#top"
          >
            <img alt="" className="size-7 rounded-lg" src="/kokoro.png" />
            Kokoro
          </a>
          <nav
            aria-label="Main navigation"
            className="hidden items-center gap-7 text-sm sm:flex"
          >
            <a
              className="text-muted-foreground transition-colors duration-150 hover:text-foreground"
              href="#features"
            >
              Features
            </a>
            <a
              className="text-muted-foreground transition-colors duration-150 hover:text-foreground"
              href="#privacy"
            >
              Privacy
            </a>
            <a
              className="text-muted-foreground transition-colors duration-150 hover:text-foreground"
              href={sourceUrl}
            >
              Source
            </a>
          </nav>
          <div className="flex items-center gap-1.5">
            <ThemeButton />
            <Button
              nativeButton={false}
              render={
                <a aria-label="Download Kokoro for macOS" href={releaseUrl} />
              }
              size="sm"
            >
              <Download data-icon="inline-start" />
              Download
            </Button>
          </div>
        </div>
      </header>

      <main id="top">
        {/* Hero */}
        <section className="relative mx-auto grid max-w-5xl items-center gap-12 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-[1fr_1.05fr] lg:py-28">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 left-1/2 -z-10 size-[36rem] -translate-x-1/2 rounded-full bg-primary/10 opacity-60 blur-[120px]"
          />
          <Reveal className="flex flex-col items-start gap-6">
            <h1 className="max-w-xl text-balance font-heading text-4xl font-semibold sm:text-5xl lg:text-[3.5rem] lg:leading-[1.02]">
              Give your reading a voice.
            </h1>
            <p className="max-w-md text-pretty text-lg leading-relaxed text-muted-foreground">
              A native Mac app that turns scripts, books, and email into natural
              speech. Everything is synthesized on your machine, so your words
              stay with you and playback starts fast.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                nativeButton={false}
                render={
                  <a
                    aria-label="Download the latest Kokoro release"
                    href={releaseUrl}
                  />
                }
                size="lg"
              >
                <Download data-icon="inline-start" />
                Download for macOS
              </Button>
              <Button
                nativeButton={false}
                render={
                  <a
                    aria-label="View Kokoro source code on GitHub"
                    href={sourceUrl}
                  />
                }
                size="lg"
                variant="outline"
              >
                <Code2 data-icon="inline-start" />
                View source
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              A standalone Mac download. No account, no browser tab.
            </p>
          </Reveal>

          <Reveal delay={120}>
            <AppPreview />
          </Reveal>
        </section>

        {/* Features */}
        <section className="border-y bg-muted/40" id="features">
          <div className="mx-auto max-w-5xl px-4 py-20 sm:px-6 sm:py-24">
            <Reveal className="mb-12 max-w-xl">
              <h2 className="font-heading text-3xl font-semibold sm:text-4xl">
                Made for listening.
              </h2>
              <p className="mt-3 text-lg leading-relaxed text-muted-foreground">
                Speech, playback, and saved audio in one focused desktop app —
                not another tab you leave open.
              </p>
            </Reveal>
            <div className="grid gap-4 md:grid-cols-3">
              {features.map((feature, i) => (
                <Reveal delay={i * 80} key={feature.title}>
                  <FeatureCard {...feature} />
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Privacy */}
        <section
          className="mx-auto grid max-w-5xl items-center gap-12 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-2"
          id="privacy"
        >
          <Reveal className="flex flex-col items-start gap-6">
            <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ShieldCheck aria-hidden="true" className="size-5" />
            </div>
            <h2 className="font-heading text-3xl font-semibold sm:text-4xl">
              Your text never leaves your Mac.
            </h2>
            <p className="max-w-md text-lg leading-relaxed text-muted-foreground">
              The app bundles its own Kokoro model and Rust speech engine. Text
              is synthesized locally, and the audio it makes is saved wherever
              you put it.
            </p>
            <Button
              nativeButton={false}
              render={
                <a aria-label="Explore the Kokoro source code" href={sourceUrl} />
              }
              variant="outline"
            >
              Read the source
              <ArrowRight data-icon="inline-end" />
            </Button>
          </Reveal>

          <Reveal delay={100}>
            <Card className="shadow-xs">
              <CardHeader>
                <CardTitle>What you get</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <ul className="flex flex-col">
                  {specs.map((spec, i) => (
                    <li
                      key={spec}
                      className={cn(
                        "flex items-center gap-3 py-3 text-[15px]",
                        i > 0 && "border-t",
                      )}
                    >
                      <Check
                        aria-hidden="true"
                        className="size-4 shrink-0 text-primary"
                      />
                      {spec}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </Reveal>
        </section>

        {/* Call to action */}
        <section className="mx-auto max-w-5xl px-4 pb-20 sm:px-6 sm:pb-28">
          <Reveal>
            <div className="relative overflow-hidden rounded-3xl border bg-muted/40 px-6 py-16 text-center">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-40 bg-primary/10 blur-3xl"
              />
              <div className="mx-auto flex max-w-md flex-col items-center gap-5">
                <Pause aria-hidden="true" className="size-7 text-primary" />
                <h2 className="font-heading text-3xl font-semibold sm:text-4xl">
                  Stop reading. Start listening.
                </h2>
                <p className="text-lg leading-relaxed text-muted-foreground">
                  Download Kokoro and make your first bit of audio, entirely on
                  your own machine.
                </p>
                <Button
                  className="mt-1"
                  nativeButton={false}
                  render={
                    <a
                      aria-label="Get the latest Kokoro release for macOS"
                      href={releaseUrl}
                    />
                  }
                  size="lg"
                >
                  <Download data-icon="inline-start" />
                  Download for macOS
                </Button>
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="mx-auto max-w-5xl px-4 pb-8 sm:px-6">
        <Separator />
        <div className="flex flex-col gap-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <img alt="" className="size-5 rounded-md" src="/kokoro.png" />
            <span>Kokoro · Local text-to-speech for macOS</span>
          </div>
          <a
            className="flex items-center gap-2 transition-colors duration-150 hover:text-foreground"
            href={sourceUrl}
          >
            <Code2 aria-hidden="true" className="size-4" />
            Open source on GitHub
          </a>
        </div>
      </footer>
    </div>
  )
}

export default App
