import { PackageError } from "@ritsuwastaken/upackage";

export class ObjectError extends PackageError {
  constructor(message: string, offset = -1) {
    super(message, offset);
    this.name = "ObjectError";
  }
}
