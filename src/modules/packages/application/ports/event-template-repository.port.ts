import type { DomainError } from "../../../../shared/domain/domain-error";
import type { Result } from "../../../../shared/domain/result";
import type {
  CreatedEventTemplateDto,
  EventTemplateDto,
  InstantiatedEventDto,
  RenamedEventTemplateDto,
} from "../dtos/event-template.dto";

export interface CreateEventTemplateFromPackageParams {
  readonly packageId: string;
  readonly ownerId: string;
  readonly name: string;
}

export interface InstantiateEventFromTemplateParams {
  readonly templateId: string;
  readonly ownerId: string;
  readonly name: string;
}

export interface RenameEventTemplateParams {
  readonly templateId: string;
  readonly ownerId: string;
  readonly name: string;
}

export interface DeleteEventTemplateParams {
  readonly templateId: string;
  readonly ownerId: string;
}

/**
 * Mutaciones atómicas entre eventos y plantillas. Cada operación es un único
 * RPC `SECURITY INVOKER` de service_role que vuelve a comprobar la propiedad,
 * de modo que la frontera HTTP no es la única defensa.
 */
export interface EventTemplateRepository {
  createFromPackage(
    params: CreateEventTemplateFromPackageParams,
  ): Promise<Result<CreatedEventTemplateDto, DomainError>>;
  instantiate(
    params: InstantiateEventFromTemplateParams,
  ): Promise<Result<InstantiatedEventDto, DomainError>>;
  rename(params: RenameEventTemplateParams): Promise<Result<RenamedEventTemplateDto, DomainError>>;
  delete(params: DeleteEventTemplateParams): Promise<Result<boolean, DomainError>>;
}

/** Lecturas privadas: siempre filtran por `owner_id`, nunca exponen ajenas. */
export interface EventTemplateReader {
  listByOwner(ownerId: string): Promise<Result<readonly EventTemplateDto[], DomainError>>;
  getTemplate(
    templateId: string,
    ownerId: string,
  ): Promise<Result<EventTemplateDto | null, DomainError>>;
}
