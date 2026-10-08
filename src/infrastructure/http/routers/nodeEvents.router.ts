import { Router, type Request, type Response } from "express";
import { logInfo } from "../../../shared/logger";
import type { ValidateNodeDeletionUseCase } from "../../../application/intents/ValidateNodeDeletionUseCase";
import { validateNodeDeletedEvent } from "../middleware/validation";

interface NodeEventsRouterDeps {
  validateNodeDeletionUseCase: ValidateNodeDeletionUseCase;
}

export function createNodeEventsRouter(deps: NodeEventsRouterDeps): Router {
  const { validateNodeDeletionUseCase } = deps;
  const router = Router();

  router.post("/api/node-events", validateNodeDeletedEvent, async (req: Request, res: Response) => {
    const event = req.nodeDeletedEvent!;

    const validation = await validateNodeDeletionUseCase.execute({
      nodeId: event.node_id,
      nodeType: event.node_type,
    });

    if (!validation.ok) {
      if (validation.code === "ASSOCIATED") {
        const intentNames = validation.intents.map((i) => i.intent).join(", ");
        res.status(409).json({
          ok: false,
          error: `Node '${event.node_id}' is associated with the following intents: ${intentNames}. Unlink it before deleting it.`,
          intents: validation.intents,
        });
        return;
      }
      res.status(500).json({ ok: false, error: validation.message });
      return;
    }

    logInfo("node_event.received", {
      event: event.event,
      nodeId: event.node_id,
      nodeType: event.node_type,
      nodeName: event.node_name,
      flowId: event.flow_id,
      timestamp: event.timestamp,
    });

    res.status(202).json({ ok: true, received: event });
  });

  return router;
}
