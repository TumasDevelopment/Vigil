"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { saveFloorPlanAction } from "@/lib/actions";
import { PLAN_MAX_BYTES } from "@/lib/plan.mjs";
import type { FloorPlan } from "@/lib/types";
import { Modal, SubmitButton, useFormAction } from "./forms";
import { IconOffline, IconOnline, IconPlus } from "./icons";
import { useLiveData } from "./useLiveData";

const SIDES = [2400, 1800, 1400];
const QUALITIES = [0.85, 0.7, 0.55];

const encode = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Riduce la pianta nel browser: il server accetta meno di 1 MB. Riscriverla toglie anche
 * i metadati della foto, e la rende un'immagine semplice qualunque cosa contenesse il file.
 */
async function shrinkImage(file: File) {
  const bitmap = await createImageBitmap(file);
  try {
    for (const side of SIDES) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const context = canvas.getContext("2d");
      if (!context) break;
      // Una pianta trasparente sul fondo scuro del sito non si leggerebbe
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      for (const quality of QUALITIES) {
        const webp = await encode(canvas, "image/webp", quality);
        // Chi non sa scrivere WebP restituisce un PNG, che sarebbe enorme
        const image = webp?.type === "image/webp" ? webp : await encode(canvas, "image/jpeg", quality);
        if (image && image.size <= PLAN_MAX_BYTES) return image;
      }
    }
  } finally {
    bitmap.close();
  }
  throw new Error("Immagine troppo pesante");
}

export function PlanForm({
  plan,
  onDone,
  onSaved,
}: {
  plan: FloorPlan | null;
  onDone: () => void;
  onSaved: (id: number) => void;
}) {
  const { state, pending, submit } = useFormAction(saveFloorPlanAction);
  const [preparing, setPreparing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (state?.ok && state.id) onSaved(state.id);
  }, [state, onSaved]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get("image");
    setProblem(null);
    if (file instanceof File && file.size > 0) {
      setPreparing(true);
      try {
        const image = await shrinkImage(file);
        form.set("image", image, "pianta");
      } catch {
        setProblem("Immagine non leggibile: usa un file PNG, JPEG o WebP.");
        return;
      } finally {
        setPreparing(false);
      }
    }
    submit(form);
  }

  const error = problem ?? state?.error;
  return (
    <form onSubmit={onSubmit} className="form">
      {plan && <input type="hidden" name="id" value={plan.id} />}
      {error && (
        <div className="notice notice--error" role="alert">
          {error}
        </div>
      )}
      <label className="field">
        <span>Nome</span>
        <input
          className="input"
          name="name"
          defaultValue={plan?.name}
          maxLength={60}
          required
          placeholder="Magazzino, piano terra"
        />
      </label>
      <label className="field">
        <span>{plan ? "Nuova immagine (facoltativa)" : "Immagine della pianta"}</span>
        <input
          className="input"
          type="file"
          name="image"
          accept="image/png,image/jpeg,image/webp"
          required={plan === null}
        />
        <small>PNG, JPEG o WebP. Da un PDF o un disegno CAD esporta prima un&apos;immagine.</small>
      </label>
      {plan && <p className="form__hint">Con una nuova immagine i dispositivi restano dove sono: controlla le posizioni.</p>}
      <div className="form__actions">
        <button type="button" className="btn" onClick={onDone}>
          Annulla
        </button>
        <SubmitButton pending={pending || preparing} pendingLabel={preparing ? "Preparazione…" : "Salvataggio…"}>
          Salva
        </SubmitButton>
      </div>
    </form>
  );
}

function PlanCard({ plan }: { plan: FloorPlan }) {
  const down = plan.markers.filter((marker) => marker.status === "offline" || marker.status === "unreachable").length;
  const total = plan.markers.length;
  return (
    <Link className="plan-card" href={`/planimetrie/${plan.id}`}>
      <span className="plan-card__image">
        {/* Il browser la tiene in cache: l'indirizzo cambia con l'immagine */}
        <img src={`/api/planimetrie/${plan.id}/immagine?v=${plan.version}`} alt="" loading="lazy" />
      </span>
      <span className="plan-card__body">
        <span className="cell-main">{plan.name}</span>
        <span className="plan-card__state">
          <span className="muted">{total === 1 ? "1 dispositivo" : `${total} dispositivi`}</span>
          {down > 0 ? (
            <span className="badge badge--offline">
              <IconOffline />
              {down} giù
            </span>
          ) : (
            total > 0 && (
              <span className="badge badge--online">
                <IconOnline />
                Tutto ok
              </span>
            )
          )}
        </span>
      </span>
    </Link>
  );
}

export function PlansList({ canEdit }: { canEdit: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const { data: plans, error } = useLiveData<FloorPlan[]>("/api/planimetrie");

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Planimetrie</h1>
          <p>Le piante dei reparti con i dispositivi e il loro stato.</p>
        </div>
        {canEdit && (
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>
              <IconPlus />
              Nuova planimetria
            </button>
          </div>
        )}
      </header>

      {error && (
        <div className="notice notice--error" role="alert">
          {error}
        </div>
      )}

      {plans && plans.length === 0 && (
        <section className="panel">
          <div className="empty">
            {canEdit ? "Nessuna planimetria. Carica la pianta di un reparto." : "Nessuna planimetria disponibile."}
          </div>
        </section>
      )}

      {plans && plans.length > 0 && (
        <div className="plan-grid">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} />
          ))}
        </div>
      )}

      {adding && (
        <Modal title="Nuova planimetria" onClose={() => setAdding(false)}>
          <PlanForm
            plan={null}
            onDone={() => setAdding(false)}
            onSaved={(id) => router.push(`/planimetrie/${id}`)}
          />
        </Modal>
      )}
    </>
  );
}
