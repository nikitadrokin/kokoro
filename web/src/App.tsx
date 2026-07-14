import {
  ArrowRight,
  AudioLines,
  BookOpen,
  Check,
  Code2,
  Download,
  FileAudio,
  Laptop,
  Mail,
  Moon,
  Play,
  ShieldCheck,
  Sparkles,
  Sun,
  Terminal,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { useTheme } from "@/components/theme-provider"

const releaseUrl = "https://github.com/nikitadrokin/kokoro/releases/latest"
const sourceUrl = "https://github.com/nikitadrokin/kokoro"

const features = [
  {
    icon: AudioLines,
    title: "Turn writing into speech",
    description:
      "Paste a script, choose a voice, and hear natural speech without sending the text to a synthesis service.",
  },
  {
    icon: BookOpen,
    title: "Listen through long reads",
    description:
      "Open EPUBs, resume where you left off, and let Kokoro turn a reading list into a listening queue.",
  },
  {
    icon: Mail,
    title: "Catch up on your inbox",
    description:
      "Connect Gmail and listen to the messages that matter while local Kokoro voices handle the narration.",
  },
]

const details = [
  "Natural Kokoro v1.0 voices",
  "Streaming playback and saved WAV files",
  "A native, focused macOS experience",
  "Open-source Rust and React foundation",
]

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

function AppPreview() {
  return (
    <Card className="relative shadow-lg">
      <CardHeader className="border-b">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2" aria-hidden="true">
            <span className="size-2.5 rounded-full bg-muted-foreground/30" />
            <span className="size-2.5 rounded-full bg-muted-foreground/30" />
            <span className="size-2.5 rounded-full bg-muted-foreground/30" />
          </div>
          <Badge variant="secondary">
            <ShieldCheck data-icon="inline-start" />
            On-device synthesis
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <AudioLines aria-hidden="true" className="size-5" />
            </div>
            <div>
              <p className="font-medium">Speech playground</p>
              <p className="text-muted-foreground">Voice · Heart</p>
            </div>
          </div>
          <Badge variant="outline">Ready</Badge>
        </div>

        <div className="min-h-32 rounded-3xl bg-muted/70 p-4 leading-relaxed text-muted-foreground ring-1 ring-foreground/5">
          Read this out loud, naturally. Kokoro turns the words on your Mac into
          speech you can stream now or save for later.
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-muted-foreground">
            <FileAudio aria-hidden="true" className="size-4" />
            <span>About 12 seconds</span>
          </div>
          <Button nativeButton={false} render={<span aria-hidden="true" />}>
            <Play data-icon="inline-start" />
            Generate speech
          </Button>
        </div>

        <div className="flex items-center gap-3 rounded-3xl bg-secondary p-3">
          <div className="flex size-9 items-center justify-center rounded-full bg-background shadow-sm">
            <Play aria-hidden="true" className="size-4" />
          </div>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
            <div className="h-full w-2/5 rounded-full bg-primary" />
          </div>
          <span className="text-muted-foreground">0:05 / 0:12</span>
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
    <Card className="shadow-sm transition-transform duration-200 ease-in-out hover:-translate-y-1">
      <CardHeader>
        <div className="mb-2 flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Icon aria-hidden="true" className="size-5" />
        </div>
        <CardTitle>{title}</CardTitle>
        <CardDescription className="leading-relaxed">
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent className="mt-auto">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Check aria-hidden="true" className="size-4 text-primary" />
          <span>Included in the Mac app</span>
        </div>
      </CardContent>
    </Card>
  )
}

export function App() {
  return (
    <div className="h-svh overflow-y-auto scroll-smooth bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <a
            aria-label="Kokoro home"
            className="flex items-center gap-2 font-medium"
            href="#top"
          >
            <img
              alt=""
              className="size-8 rounded-xl shadow-sm"
              src="/kokoro.png"
            />
            Kokoro
          </a>
          <nav
            aria-label="Main navigation"
            className="hidden items-center gap-6 sm:flex"
          >
            <a
              className="text-muted-foreground transition-colors duration-200 hover:text-foreground"
              href="#features"
            >
              Features
            </a>
            <a
              className="text-muted-foreground transition-colors duration-200 hover:text-foreground"
              href="#privacy"
            >
              Privacy
            </a>
            <a
              className="text-muted-foreground transition-colors duration-200 hover:text-foreground"
              href={sourceUrl}
            >
              Source
            </a>
          </nav>
          <div className="flex items-center gap-2">
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
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-[0.9fr_1.1fr] lg:py-32">
          <div className="flex flex-col items-start gap-6">
            <Badge variant="secondary">
              <Sparkles data-icon="inline-start" />
              Private speech, made on your Mac
            </Badge>
            <div className="flex flex-col gap-4">
              <h1 className="max-w-xl font-heading text-4xl font-semibold tracking-tight sm:text-6xl">
                Give your reading a voice.
              </h1>
              <p className="max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
                Kokoro is a native macOS app for turning scripts, books, and
                email into natural speech. Synthesis runs locally, so your words
                stay close and playback starts fast.
              </p>
            </div>
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
            <p className="flex items-center gap-2 text-muted-foreground">
              <Laptop aria-hidden="true" className="size-4" />A standalone Mac
              download. No web account required.
            </p>
          </div>

          <div className="relative">
            <div
              aria-hidden="true"
              className="absolute -inset-4 rounded-[3rem] bg-primary/5"
            />
            <AppPreview />
          </div>
        </section>

        <section className="border-y bg-muted/40" id="features">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
            <div className="mb-10 flex max-w-2xl flex-col gap-3">
              <Badge className="self-start" variant="outline">
                Built for listening
              </Badge>
              <h2 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
                One calm place for everything you want to hear.
              </h2>
              <p className="leading-relaxed text-muted-foreground">
                Kokoro keeps speech generation, playback, and saved audio in a
                focused desktop workflow instead of another browser tab.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {features.map((feature) => (
                <FeatureCard key={feature.title} {...feature} />
              ))}
            </div>
          </div>
        </section>

        <section
          className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-2"
          id="privacy"
        >
          <div className="flex flex-col gap-6">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <ShieldCheck aria-hidden="true" className="size-6" />
            </div>
            <div className="flex flex-col gap-3">
              <h2 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
                The voice engine lives with you.
              </h2>
              <p className="max-w-xl leading-relaxed text-muted-foreground">
                The desktop app bundles its Kokoro model and Rust speech engine.
                Your text is synthesized on your machine, and generated audio is
                saved where you control it.
              </p>
            </div>
            <Button
              className="self-start"
              nativeButton={false}
              render={
                <a
                  aria-label="Explore the Kokoro source code"
                  href={sourceUrl}
                />
              }
              variant="outline"
            >
              Explore the code
              <ArrowRight data-icon="inline-end" />
            </Button>
          </div>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Made as a real Mac app</CardTitle>
              <CardDescription>
                The website introduces Kokoro. The application is a separate,
                downloadable desktop bundle.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {details.map((detail) => (
                <div className="flex items-center gap-3" key={detail}>
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Check aria-hidden="true" className="size-4" />
                  </div>
                  <span>{detail}</span>
                </div>
              ))}
            </CardContent>
            <CardFooter className="gap-2 border-t text-muted-foreground">
              <Terminal aria-hidden="true" className="size-4" />
              Local model · Rust sidecar · Native bundle
            </CardFooter>
          </Card>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 sm:pb-24">
          <Card className="bg-primary text-primary-foreground shadow-md">
            <CardHeader className="items-center text-center">
              <div className="mb-2 flex size-12 items-center justify-center rounded-2xl bg-primary-foreground/10">
                <AudioLines aria-hidden="true" className="size-6" />
              </div>
              <CardTitle className="text-2xl">Ready to listen?</CardTitle>
              <CardDescription className="max-w-xl text-primary-foreground/75">
                Download Kokoro as a standalone macOS app and make your first
                piece of audio locally.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center">
              <Button
                nativeButton={false}
                render={
                  <a
                    aria-label="Get the latest Kokoro release for macOS"
                    href={releaseUrl}
                  />
                }
                size="lg"
                variant="secondary"
              >
                <Download data-icon="inline-start" />
                Get Kokoro for macOS
              </Button>
            </CardContent>
          </Card>
        </section>
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-8 sm:px-6">
        <Separator />
        <div className="flex flex-col gap-4 py-6 text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <img alt="" className="size-6 rounded-lg" src="/kokoro.png" />
            <span>Kokoro · Local text-to-speech for macOS</span>
          </div>
          <a
            className="flex items-center gap-2 transition-colors duration-200 hover:text-foreground"
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
