import { useParams } from "react-router-dom";

export function PartDetail() {
  const { id } = useParams();
  return <h1 data-part-id={id}>Part detail</h1>;
}
